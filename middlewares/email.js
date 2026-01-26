// const nodemailer = require("nodemailer");
// const fs = require("fs");
// const { promisify } = require("util");

// const readFile = promisify(fs.readFile);

// const email = async (receiver, subject, body, replacements = {}) => {
//   try {
//     let transporter = nodemailer.createTransport({
//       host: "mail.merrymemorries.com",
//       port: 465,
//       secure: false,
//       auth: {
//         user: "support@merrymemorries.com",
//         pass: "ZQor41rI7qIdh",
//       },
//     });

//     // Read HTML template
//     let html = await readFile(`html_mails/${body}`, "utf8");

//     // Replace all placeholders dynamically
//     for (let key in replacements) {
//       const placeholder = new RegExp(`{{${key}}}`, "g");
//       html = html.replace(placeholder, replacements[key]);
//     }

//     // Send email
//     let info = await transporter.sendMail({
//       from: '"Property Listing API" <support@merrymemorries.com>',
//       to: receiver,
//       subject: subject,
//       html: html,
//     });

//     console.log("Email sent:", info.messageId);
//   } catch (err) {
//     console.error("Email Error:", err);
//     throw err;
//   }
// };

// module.exports = email;

const nodemailer = require("nodemailer");
const fs = require("fs");
const { promisify } = require("util");

const readFile = promisify(fs.readFile);

const email = async (receiver, subject, body, replacements = {}) => {
  try {
    const transporter = nodemailer.createTransport({
      host: "mail.merrymemorries.com",
      port: 587,
      secure: false, // MUST be false for 587
      auth: {
        user: "support@merrymemorries.com",
        pass: process.env.EMAIL_PASS, // move to env
      },
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });

    // Verify connection
    await transporter.verify();
    console.log("SMTP connected successfully");

    let html = await readFile(`html_mails/${body}`, "utf8");

    for (let key in replacements) {
      const placeholder = new RegExp(`{{${key}}}`, "g");
      html = html.replace(placeholder, replacements[key]);
    }

    let info = await transporter.sendMail({
      from: '"Property Listing API" <support@merrymemorries.com>',
      to: receiver,
      subject,
      html,
    });

    console.log("Email sent:", info.messageId);
  } catch (err) {
    console.error("Email Error:", err);
    throw err;
  }
};

module.exports = email;
