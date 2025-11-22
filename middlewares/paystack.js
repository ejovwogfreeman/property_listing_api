const axios = require("axios");

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET; // add your secret key in .env

// Initialize transaction
exports.initializeTransaction = async (email, amount, reference) => {
  try {
    const res = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      { email, amount, reference },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          "Content-Type": "application/json",
        },
      }
    );
    return res.data;
  } catch (err) {
    throw new Error(err.response?.data?.message || err.message);
  }
};

// Verify transaction
exports.verifyTransaction = async (reference) => {
  try {
    const res = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
      }
    );
    return res.data;
  } catch (err) {
    throw new Error(err.response?.data?.message || err.message);
  }
};
