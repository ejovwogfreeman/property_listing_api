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
 * @desc Create Agent Bank Details (First bank automatically becomes default)
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

    // Check if this exact account number already exists for this bank globally
    const existingBank = await Bank.findOne({
      bankName: bankName.trim(),
      accountNumber: accountNumber.trim(),
    });

    if (existingBank) {
      return res.status(400).json({
        success: false,
        message: "This bank account has already been registered in the system.",
      });
    }

    // Check if this agent already has any other banks
    const existingAgentBanksCount = await Bank.countDocuments({ user: userId });

    // If it's their very first bank, make it default (true), otherwise false
    const isDefault = existingAgentBanksCount === 0;

    const bankDetails = await Bank.create({
      user: userId,
      bankName,
      bankCode,
      accountNumber,
      accountName,
      isDefault,
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
 * @desc Set a specific bank account as default (turns off others for that agent)
 * @route PATCH /api/bank/:id/default
 * @access Private (Agent owner or Admin)
 */
const setDefaultBank = async (req, res) => {
  try {
    const bankId = req.params.id;
    const userId = req.user._id;

    // Find the bank target
    const targetBank = await Bank.findById(bankId);
    if (!targetBank) {
      return res.status(404).json({
        success: false,
        message: "Bank record not found",
      });
    }

    // Ensure authorization (must be admin or the owner of the bank account)
    if (
      req.user.role !== "admin" &&
      targetBank.user.toString() !== userId.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to modify this bank record",
      });
    }

    // 1. Set all banks belonging to this agent to isDefault: false
    await Bank.updateMany({ user: targetBank.user }, { isDefault: false });

    // 2. Set the selected bank to isDefault: true
    targetBank.isDefault = true;
    await targetBank.save();

    return res.status(200).json({
      success: true,
      message: "Default bank updated successfully",
      data: targetBank,
    });
  } catch (err) {
    console.error("setDefaultBank error:", err);
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
 * @desc Get all bank details of a particular user/agent
 * @route GET /api/bank/user/:userId
 * @access Private (Admin or the user themselves)
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

    // Changed from findOne to find to retrieve all banks for this user
    const bankDetails = await Bank.find({ user: targetUserId }).populate(
      "user",
      "name email role",
    );

    if (!bankDetails || bankDetails.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No bank details found for this user",
      });
    }

    return res.status(200).json({
      success: true,
      count: bankDetails.length,
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
  setDefaultBank,
  getSingleBankDetails,
  getAgentBankDetails,
  getAllBanks,
  updateBankDetails,
  deleteBankDetails,
};
