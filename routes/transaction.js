const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // Handles multipart/form-data text fields
const {
  walletFunding,
  confirmFundWallet,
  verifyWalletFunding,
  payAgent,
  changeTransactionStatus,
  getUserTransactionsAndEscrows,
  getAgentTransactionsAndEscrows,
  getAllTransactionsAndEscrows,
  getUserPurchasesAndInspections,
  getAgentPurchasesAndInspections,
  getAllPurchasesAndInspections,
  requestWithdrawal,
} = require("../controllers/transaction");
const { protect, authorize } = require("../middlewares/auth");
const { requireWithdrawalPin } = require("../middlewares/withdrawalPin");

// ---------------------------
// Transaction Routes
// ---------------------------

// Fund Wallet Initialization
router.post("/fund-wallet", protect, upload.none(), walletFunding);

// Confirm Fund Wallet (User callback / Webhook verification)
router.post("/confirm-fund-wallet", protect, upload.none(), confirmFundWallet);

// Verify Fund Wallet (Admin Approval)
router.post(
  "/verify-fund-wallet",
  protect,
  authorize("admin"),
  upload.none(),
  verifyWalletFunding,
);

// Pay Agent
router.post("/pay-agent", protect, authorize("admin"), upload.none(), payAgent);

// Change Transaction Status
router.post(
  "/change-transaction-status",
  protect,
  authorize("admin"),
  upload.none(),
  changeTransactionStatus,
);

// Get User Transactions Activities
router.get(
  "/user-transactions-activities",
  protect,
  getUserTransactionsAndEscrows,
);

// Get Agent Transactions Activities
router.get(
  "/agent-transactions-activities",
  protect,
  authorize("agent"),
  getAgentTransactionsAndEscrows,
);

// Get All Transactions Activities
router.get(
  "/all-transactions-activities",
  protect,
  authorize("admin"),
  getAllTransactionsAndEscrows,
);

// Get User Purchases & Inspections
router.get("/user-transactions", protect, getUserPurchasesAndInspections);

// Get Agent Purchases & Inspections
router.get(
  "/agent-transactions",
  protect,
  authorize("agent"),
  getAgentPurchasesAndInspections,
);

// Get All Purchases & Inspections
router.get(
  "/all-transactions",
  protect,
  authorize("admin"),
  getAllPurchasesAndInspections,
);

// Request Withdrawal (the agent's withdrawal PIN is checked first)
router.post(
  "/withdraw",
  protect,
  authorize("agent"),
  upload.none(),
  requireWithdrawalPin,
  requestWithdrawal,
);

module.exports = router;
