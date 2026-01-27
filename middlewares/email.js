const nodemailer = require("nodemailer");
const fs = require("fs");
const { promisify } = require("util");

const readFile = promisify(fs.readFile);

const email = async (receiver, subject, body, replacements = {}) => {
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp-relay.brevo.com",
      port: 587,
      secure: false,
      auth: {
        user: "apikey", // fixed value for Brevo
        pass: process.env.BREVO_SMTP_KEY, // your SMTP key
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
      from: `"Property Listing API" <${process.env.BREVO_EMAIL_USERNAME}>`,
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
