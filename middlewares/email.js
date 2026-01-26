const nodemailer = require("nodemailer");
const fs = require("fs");
const { promisify } = require("util");

const readFile = promisify(fs.readFile);

const email = async (receiver, subject, body, replacements = {}) => {
  try {
    let transporter = nodemailer.createTransport({
      host: "mail.universaltrustlogistiks.com",
      port: 465,
      secure: false,
      auth: {
        user: "support@universaltrustlogistiks.com",
        pass: "ZOdt227SZxjHy",
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
      from: '"Property Listing API" <support@universaltrustlogistiks.com>',
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
