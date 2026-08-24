const axios = require("axios");
const Bank = require("../models/bank");
const User = require("../models/user");

/**
 * @desc Resolve Account Name from Bank Number and Code (via Paystack)
 * @route POST /api/bank/resolve
 * @access Private (Agent only)
 */
/**
 * @desc Resolve Account Name using only Account Number and Bank Name
 * @route POST /api/bank/resolve
 * @access Private (Agent only)
 */
const resolveAccountDetails = async (req, res) => {
  try {
    const userId = req.user._id;
    const { accountNumber, bankName } = req.body; // Notice we only ask for bankName now

    if (!accountNumber || !bankName) {
      return res.status(400).json({
        success: false,
        message: "Account number and bank name are required",
      });
    }

    // 1. Verify user is an agent
    const user = await User.findById(userId);
    if (!user || user.role !== "agent") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only agents can resolve bank accounts.",
      });
    }

    // 2. Fetch the list of all banks from Paystack
    const bankListResponse = await axios.get("https://api.paystack.co/bank", {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
      },
    });

    const banks = bankListResponse.data.data;

    // 3. Find the bank code that matches the provided bank name
    // (Using .toLowerCase() and .includes() to make the search flexible)
    const matchedBank = banks.find((bank) =>
      bank.name.toLowerCase().includes(bankName.trim().toLowerCase()),
    );

    if (!matchedBank) {
      return res.status(404).json({
        success: false,
        message: `Could not find a bank code for '${bankName}'. Please check the spelling.`,
      });
    }

    const bankCode = matchedBank.code; // We found the code!

    // 4. Call Paystack Resolve Account API with the dynamically found code
    const resolveResponse = await axios.get(
      `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
        },
      },
    );

    if (!resolveResponse.data || !resolveResponse.data.status) {
      return res.status(400).json({
        success: false,
        message:
          "Could not resolve account details. Please check the account number.",
      });
    }

    const { account_name, account_number } = resolveResponse.data.data;

    // 5. Return the resolved name AND the code (so the frontend can save it easily later)
    return res.status(200).json({
      success: true,
      message: "Account resolved successfully",
      data: {
        accountName: account_name,
        accountNumber: account_number,
        bankName: matchedBank.name, // Returns the official bank name from Paystack
        bankCode: bankCode, // Returns the code so frontend can just pass it to your save route
      },
    });
  } catch (err) {
    console.error(
      "resolveAccountDetails error:",
      err.response?.data || err.message,
    );
    return res.status(400).json({
      success: false,
      message: "Failed to verify account number. Ensure details are correct.",
      error: err.response?.data?.message || err.message,
    });
  }
};

/**
 * @desc Create Agent Bank Details
 * @route POST /api/bank
 * @access Private (Agent only)
 */
const saveBankDetails = async (req, res) => {
  try {
    const userId = req.user._id;
    const { bankName, bankCode, accountNumber, accountName } = req.body;

    // Validate inputs
    if (!bankName || !bankCode || !accountNumber || !accountName) {
      return res.status(400).json({
        success: false,
        message:
          "All bank fields (bankName, bankCode, accountNumber, accountName) are required",
      });
    }

    // Verify user is an agent
    const user = await User.findById(userId);
    if (!user || user.role !== "agent") {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. Only agents are authorized to add bank details.",
      });
    }

    // Check if bank details already exist for this agent
    const existingBank = await Bank.findOne({ user: userId });
    if (existingBank) {
      return res.status(400).json({
        success: false,
        message:
          "Bank details already exist. Please use the update route instead.",
      });
    }

    // Create new bank record
    const bankDetails = await Bank.create({
      user: userId,
      bankName,
      bankCode,
      accountNumber,
      accountName,
    });

    return res.status(201).json({
      success: true,
      message: "Bank details saved successfully",
      data: bankDetails,
    });
  } catch (err) {
    console.error("saveBankDetails error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

/**
 * @desc Get Agent Bank Details
 * @route GET /api/bank
 * @access Private (Agent only)
 */
const getBankDetails = async (req, res) => {
  try {
    const userId = req.user._id;

    // Verify user is an agent
    const user = await User.findById(userId);
    if (!user || user.role !== "agent") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only agents can view bank details.",
      });
    }

    const bankDetails = await Bank.findOne({ user: userId });

    if (!bankDetails) {
      return res.status(404).json({
        success: false,
        message: "No bank details found for this agent",
      });
    }

    return res.status(200).json({
      success: true,
      data: bankDetails,
    });
  } catch (err) {
    console.error("getBankDetails error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

/**
 * @desc Update Agent Bank Details
 * @route PUT /api/bank
 * @access Private (Agent only)
 */
const updateBankDetails = async (req, res) => {
  try {
    const userId = req.user._id;
    const { bankName, bankCode, accountNumber, accountName } = req.body;

    // Validate inputs
    if (!bankName || !bankCode || !accountNumber || !accountName) {
      return res.status(400).json({
        success: false,
        message: "All bank fields are required for update",
      });
    }

    // Verify user is an agent
    const user = await User.findById(userId);
    if (!user || user.role !== "agent") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only agents can update bank details.",
      });
    }

    // Find existing bank details
    const bank = await Bank.findOne({ user: userId });
    if (!bank) {
      return res.status(404).json({
        success: false,
        message: "No bank details found. Please create one first.",
      });
    }

    // Update fields
    bank.bankName = bankName;
    bank.bankCode = bankCode;
    bank.accountNumber = accountNumber;
    bank.accountName = accountName;

    await bank.save();

    return res.status(200).json({
      success: true,
      message: "Bank details updated successfully",
      data: bank,
    });
  } catch (err) {
    console.error("updateBankDetails error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

/**
 * @desc Delete Agent Bank Details
 * @route DELETE /api/bank
 * @access Private (Agent only)
 */
const deleteBankDetails = async (req, res) => {
  try {
    const userId = req.user._id;

    // Verify user is an agent
    const user = await User.findById(userId);
    if (!user || user.role !== "agent") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only agents can delete bank details.",
      });
    }

    // Find and delete the bank record tied to this user
    const deletedBank = await Bank.findOneAndDelete({ user: userId });

    if (!deletedBank) {
      return res.status(404).json({
        success: false,
        message: "No bank details found to delete",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Bank details deleted successfully",
    });
  } catch (err) {
    console.error("deleteBankDetails error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

module.exports = {
  resolveAccountDetails,
  saveBankDetails,
  getBankDetails,
  updateBankDetails,
  deleteBankDetails,
};
