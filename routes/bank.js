const express = require("express");
const router = express.Router();
const {
  resolveAccountDetails,
  saveBankDetails,
  getBankDetails,
  updateBankDetails,
  deleteBankDetails,
} = require("../controllers/bank");
const { protect } = require("../middlewares/auth"); // Adjust path to your auth middleware

// 1. Resolve account name from Paystack before saving
router.post("/resolve", protect, resolveAccountDetails);

// 2. Create agent bank details
router.post("/", protect, saveBankDetails);

// 3. Get saved agent bank details
router.get("/", protect, getBankDetails);

// 4. Update agent bank details
router.put("/", protect, updateBankDetails);

// 5. Delete agent bank details
router.delete("/", protect, deleteBankDetails);

module.exports = router;
