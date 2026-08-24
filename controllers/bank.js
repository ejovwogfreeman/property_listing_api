const axios = require("axios");
const Bank = require("../models/bank");
const User = require("../models/user");

/**
 * @desc Resolve Account Name using only Account Number and Bank Name
 * @route POST /api/bank/resolve
 * @access Private (Agent only)
 */
const resolveAccountDetails = async (req, res) => {
  try {
    const userId = req.user._id;
    const { accountNumber, bankName } = req.body;

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
    const matchedBank = banks.find((bank) =>
      bank.name.toLowerCase().includes(bankName.trim().toLowerCase()),
    );

    if (!matchedBank) {
      return res.status(404).json({
        success: false,
        message: `Could not find a bank code for '${bankName}'. Please check the spelling.`,
      });
    }

    const bankCode = matchedBank.code;

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

    // 5. Return the resolved name and details
    return res.status(200).json({
      success: true,
      message: "Account resolved successfully",
      data: {
        accountName: account_name,
        accountNumber: account_number,
        bankName: matchedBank.name,
        bankCode: bankCode,
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

    if (!bankName || !bankCode || !accountNumber || !accountName) {
      return res.status(400).json({
        success: false,
        message:
          "All bank fields (bankName, bankCode, accountNumber, accountName) are required",
      });
    }

    const user = await User.findById(userId);
    if (!user || user.role !== "agent") {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. Only agents are authorized to add bank details.",
      });
    }

    const existingBank = await Bank.findOne({ user: userId });
    if (existingBank) {
      return res.status(400).json({
        success: false,
        message:
          "Bank details already exist for this user. Please use the update route instead.",
      });
    }

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
 * @desc Get Logged-in Agent's Bank Details
 * @route GET /api/bank
 * @access Private (Agent only)
 */
const getBankDetails = async (req, res) => {
  try {
    const userId = req.user._id;

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
 * @desc Get a Single Bank Detail Record by Bank Document ID
 * @route GET /api/bank/:id
 * @access Private (Admin or Owner Agent)
 */
const getSingleBankDetails = async (req, res) => {
  try {
    const bankId = req.params.id;

    const bankDetails = await Bank.findById(bankId).populate(
      "user",
      "name email role",
    );

    if (!bankDetails) {
      return res.status(404).json({
        success: false,
        message: "Bank record not found",
      });
    }

    // Must be admin or the owner of this bank record
    if (
      req.user.role !== "admin" &&
      bankDetails.user._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this bank record",
      });
    }

    return res.status(200).json({
      success: true,
      data: bankDetails,
    });
  } catch (err) {
    console.error("getSingleBankDetails error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * @desc Get Bank Details of a Particular User/Agent by User ID
 * @route GET /api/bank/user/:userId
 * @access Private (Admin or Owner)
 */
const getAgentBankDetails = async (req, res) => {
  try {
    const targetUserId = req.params.userId;

    if (req.user.role !== "admin" && req.user._id.toString() !== targetUserId) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view these bank details",
      });
    }

    const bankDetails = await Bank.findOne({ user: targetUserId }).populate(
      "user",
      "name email role",
    );

    if (!bankDetails) {
      return res.status(404).json({
        success: false,
        message: "No bank details found for this user",
      });
    }

    return res.status(200).json({
      success: true,
      data: bankDetails,
    });
  } catch (err) {
    console.error("getAgentBankDetails error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * @desc Get All Bank Details in DB
 * @route GET /api/bank/all
 * @access Private (Admin only)
 */
const getAllBanks = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin only.",
      });
    }

    const banks = await Bank.find()
      .populate("user", "name email role")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: banks.length,
      data: banks,
    });
  } catch (err) {
    console.error("getAllBanks error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * @desc Update Agent Bank Details using Bank Document ID
 * @route PUT /api/bank/:id
 * @access Private (Admin or Owner Agent)
 */
const updateBankDetails = async (req, res) => {
  try {
    const bankId = req.params.id;
    const { bankName, bankCode, accountNumber, accountName } = req.body;

    if (!bankName || !bankCode || !accountNumber || !accountName) {
      return res.status(400).json({
        success: false,
        message: "All bank fields are required for update",
      });
    }

    const bank = await Bank.findById(bankId);
    if (!bank) {
      return res.status(404).json({
        success: false,
        message: "Bank record not found",
      });
    }

    // Must be admin or the owner of this bank record
    if (
      req.user.role !== "admin" &&
      bank.user.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this bank record",
      });
    }

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
 * @desc Delete Agent Bank Details using Bank Document ID
 * @route DELETE /api/bank/:id
 * @access Private (Admin or Owner Agent)
 */
const deleteBankDetails = async (req, res) => {
  try {
    const bankId = req.params.id;

    const bank = await Bank.findById(bankId);
    if (!bank) {
      return res.status(404).json({
        success: false,
        message: "Bank record not found",
      });
    }

    // Must be admin or the owner of this bank record
    if (
      req.user.role !== "admin" &&
      bank.user.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this bank record",
      });
    }

    await Bank.findByIdAndDelete(bankId);

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
  getSingleBankDetails,
  getAgentBankDetails,
  getAllBanks,
  updateBankDetails,
  deleteBankDetails,
};
