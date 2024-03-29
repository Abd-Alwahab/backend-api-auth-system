const { User } = require("./../models/userModal");
const catchAsync = require("./../utils/catchAsync");
const jwt = require("jsonwebtoken");
const SendEmail = require("./../utils/email");
const crypto = require("crypto");
// const bcrypt = require("bcryptjs");

const { promisify } = require("util");

const bcrypt = require("bcryptjs");

// create a custom function for sending the json web token for the user
const sendToken = (user) => {
  const token = jwt.sign({ id: user._id, name: user.name }, process.env.token_secret, {
    expiresIn: process.env.token_date,
  });

  return token;
};

const signup = catchAsync(async (req, res, next) => {
  // --Steps for handling the signup--
  // 01-Getting the needed information from the user
  // 02-Checking if we have any missing info in the body
  // 03-Checking the user email in our database
  // 04-If we have no error then we can save the user to the database
  // 05-Send back a json web token to the user

  const { name, email, password, passwordConfirm, passwordChangedAt } = req.body;

  if (!name || !email || !password || !passwordConfirm)
    return res.status(400).json({
      status: "fail",
      data: "please provide a valid information!",
    });

  const exsistUser = await User.findOne({ email });
  // console.log(exsistUser);

  if (exsistUser)
    return res.status(400).json({
      status: "fail",
      data: "please provide a dieffernt email!",
    });

  const newUser = new User({
    name,
    email,
    password,
    passwordConfirm,
    passwordChangedAt,
  });

  await newUser.save();

  const token = sendToken(newUser);

  res.status(201).json({
    status: "success",
    data: newUser,
    token,
  });
});

const login = catchAsync(async (req, res, next) => {
  // ==Steps for handing the login
  // 01-Getting the email and password from the body
  // 02-Checking if there is a missing information from the user
  // 03-Checking if we have a user with the provieded information
  // 04-Checking if the paassword is correct
  // 05-Sending back a json web token for the user to log him/her in.
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({
      status: "fail",
      message: "please provide a valid information!",
    });

  const noUser = await User.findOne({ email });

  if (!noUser)
    return res.status(404).json({
      status: "fail",
      message: " can not find a user with email, please try agian!",
    });

  const validPassword = await bcrypt.compare(password, noUser.password);

  if (!validPassword)
    return res.status(400).json({
      status: "fail",
      message: "wrong email or password, please try agian!",
    });

  const token = sendToken(noUser);

  res.status(201).json({
    status: "success",
    data: noUser,
    token,
  });
});

// create a middleware for checking if the user is logedIn and if so we can give then some permissions
const protect = catchAsync(async (req, res, next) => {
  //01-Getting the token and cheking if its there!
  let token;
  if (req.headers.token) {
    token = req.headers.token;
  }

  if (!token)
    return res.status(400).json({
      status: "fail",
      message: "please provide a token!",
    });

  //02-Verify The token
  const decoded = await promisify(jwt.verify)(token, process.env.token_secret);

  const user = await User.findById(decoded.id);

  //03-Check for the user
  if (!user)
    return res.status(404).json({
      status: "fail",
      message: "no user find with this token",
    });

  // 04-Check if the user changes his password
  if (user.changePasswordAfter(decoded.iat))
    return res.status(400).json({
      status: "fail",
      message: "you changed your pasword recntly, please try to login again!",
    });

  req.user = user;

  next();
});

// create middleware for restric some action for spesifc users
const restricPermissions = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(401).json({
        status: "fail",
        message: "you do not have permissions!",
      });
    }

    next();
  };
};

const forgotPassword = catchAsync(async (req, res, next) => {
  // 01-Getting the email from the request body
  // 02-Find the user in the database using the provided user email
  // 03-Checking if theu user is there and if not returing back an error to the user
  // 04-Creating the token for resting the password
  // 05-Saving the updated user to the database
  // 06-Generate the needed url for sending it to the user email
  // 07-Seind the email to the user using the nodemailer and sendGrid

  const { email } = req.body;

  const user = await User.findOne({ email });

  if (!user)
    return res.status(404).json({
      status: "fail",
      message: "can not find a user with this email!",
    });

  const resetToken = user.createPasswordResetToken();

  await user.save({ validateBeforeSave: false });

  const passwordResetURL = `${req.protocol}://${req.get(
    "host"
  )}/api/v1/resetPassword/${resetToken}`;

  try {
    await SendEmail({
      reciver: user.email,
      subject: "Reset Password",
      message: `${passwordResetURL}`,
    });
    res.status(200).json({
      status: "success",
      message: "Your Password Reset Url was sent to your email!",
    });
  } catch (error) {
    user.passwordResetToken = undefined;
    user.passwordResetExpiresDate = undefined;

    await user.save({ validateBeforeSave: false });

    return res.status(500).json({
      status: "fail",
      message: "fail to send the email!",
    });
  }
});

const resetPassword = catchAsync(async (req, res, next) => {
  // 01-Getting the user base on the token

  const hashedToken = crypto.createHash("sha256").update(req.params.token).digest("hex");

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpiresDate: { $gt: Date.now() },
  });
  // 02-Checking for the user and the token expires date

  if (!user)
    return res.status(404).json({
      status: "fail",
      message: "can not find a user with this token",
    });
  // 03-Update the user password
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = undefined;
  user.passwordResetExpiresDate = undefined;
  // 04-save the user to the database
  await user.save();
  // 05-Login the user in (sending json web token)
  const token = sendToken(user);

  res.status(201).json({
    status: "success",

    token,
  });
});

const updatePassword = catchAsync(async (req, res, next) => {
  // Steps for implementing update user password
  // 01-Getting the currently logged In user
  // 02-Getting the password and the password confirm rom the request body
  // 03-Validate the password and the password confirm
  // 04-Compare the current password with the password in the database
  // 05-Update the user password and the password confirm and save the user info
  // 06-Send back a json web token to log the user in and end the response

  const user = await User.findById(req.user._id);
  const { currentPassword, newPassword, passwordConfirm } = req.body;

  if (!currentPassword || !newPassword || !passwordConfirm)
    return res.status(404).json({
      status: "fail",
      message: "please provide your password!",
    });

  const validPassword = await bcrypt.compare(currentPassword, user.password);

  if (!validPassword)
    return res.status(400).json({
      status: "fail",
      message: "wrong password, please try again!",
    });

  user.password = newPassword;
  user.passwordConfirm = passwordConfirm;
  await user.save();

  const token = sendToken(user);

  res.status(201).json({
    status: "success",

    token,
  });
});

module.exports.signup = signup;
module.exports.login = login;
module.exports.protect = protect;
module.exports.restricPermissions = restricPermissions;
module.exports.forgotPassword = forgotPassword;
module.exports.resetPassword = resetPassword;
module.exports.updatePassword = updatePassword;
