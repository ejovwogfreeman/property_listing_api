const nodemailer = require("nodemailer");
const fs = require("fs");
const { promisify } = require("util");

const readFile = promisify(fs.readFile);

const email = async (receiver, subject, body, replacements = {}) => {
  try {
    // let transporter = nodemailer.createTransport({
    //   host: "mail.merrymemorries.com",
    //   port: 587,
    //   secure: false,
    //   auth: {
    //     user: process.env.EMAIL_USERNAME,
    //     pass: process.env.EMAIL_PASSWORD,
    //   },
    // });

    let transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USERNAME,
        pass: process.env.EMAIL_PASSWORD,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    // Read HTML template
    let html = await readFile(`html_mails/${body}`, "utf8");

    // Replace all placeholders dynamically
    for (let key in replacements) {
      const placeholder = new RegExp(`{{${key}}}`, "g");
      html = html.replace(placeholder, replacements[key]);
    }

    // Send email
    let info = await transporter.sendMail({
      from: `"Property Listing API" <${process.env.EMAIL_USERNAME}>`,
      to: receiver,
      subject: subject,
      html: html,
    });

    console.log("Email sent:", info.messageId);
  } catch (err) {
    console.error("Email Error:", err);
    throw err;
  }
};

module.exports = email;
