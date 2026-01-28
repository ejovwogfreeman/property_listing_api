const nodemailer = require("nodemailer");
const fs = require("fs");
const { promisify } = require("util");

const readFile = promisify(fs.readFile);

const email = async (receiver, subject, body, replacements = {}) => {
  try {
    // Gmail SMTP transporter
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true, // true for 465
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS, // Gmail App Password
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
      from: `"Property Listing API" <${process.env.GMAIL_USER}>`,
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
