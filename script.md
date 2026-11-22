# 1. Feedback: only admins can read it

The frontend now sends feedback from the buyer's profile (`POST /feedback`) and lists the buyer's own past feedback (`GET /feedback/my`). Both already work. Four things in the feedback API need fixing.

## What's wrong

- **Agents can read everyone's feedback.** `GET /feedback` uses `authorize("admin", "agent")`, and `GET /feedback/:id` lets any agent open any item. Buyers use feedback to complain about agents, so an agent could read complaints about themselves and other agents, along with the buyers' names.
- **The sender's email isn't saved.** The model has an `email` field, but `submitFeedback` never fills it. The email to the team has it, but the database record doesn't.
- **No length limit and no trimming.** Any size of text is accepted and saved.
- **Older items without a user crash update and delete.** `feedbackItem.user.toString()` throws when `user` is empty (the model allows that).

## What changes

- `routes/feedback.js`: `GET /feedback` is admins only.
- `controllers/feedback.js`:
  - `getAllFeedback` and `getFeedbackById`: admins, or (for one item) the person who sent it. Agents no longer have special access.
  - `submitFeedback`: trims both fields, rejects feedback over 2000 characters (topic over 100), and saves the sender's `email`.
  - `updateFeedback` / `deleteFeedback`: use the same owner check, which doesn't crash when `user` is empty, and apply the same trimming and limits on update.

No model change and no migration. The responses keep the same shape.

## How to test

1. As a buyer, send feedback from Profile → Send feedback. It saves, the team email arrives, and the saved record now has `email`.
2. As an agent, call `GET /api/feedback`: it returns **403**. `GET /api/feedback/<someone else's id>` also returns **403**.
3. As an admin, `GET /api/feedback` still returns everything.
4. Send feedback longer than 2000 characters: it returns **400** with "Please keep your feedback under 2000 characters."

Both files below are complete replacements, built from commit 446fbd5.

## routes/feedback.js

```js
const express = require("express");
const router = express.Router();
const {
  submitFeedback,
  getAllFeedback,
  getMyFeedback,
  getFeedbackById,
  updateFeedback,
  deleteFeedback,
} = require("../controllers/feedback");
const { protect, authorize } = require("../middlewares/auth"); // middleware to get req.user from JWT

// POST: Submit feedback (Authenticated users/agents)
router.post("/", protect, submitFeedback);

// GET: Get all feedback (Admins only — feedback can be about agents, so
// agents must not read it)
router.get("/", protect, authorize("admin"), getAllFeedback);

// GET: Get logged-in user's feedback
router.get("/my", protect, getMyFeedback);

// GET feedback by ID (the person who sent it, or an admin)
router.get("/:id", protect, getFeedbackById);

// PUT: Update feedback by ID (Owner or Admin)
router.put("/:id", protect, updateFeedback);

// DELETE: Delete feedback by ID (Owner or Admin)
router.delete("/:id", protect, deleteFeedback);

module.exports = router;
```

## controllers/feedback.js

```js
const Feedback = require("../models/feedback");
const Email = require("../middlewares/email");

// limits on what one feedback message can hold
const MAX_ABOUT = 100;
const MAX_FEEDBACK = 2000;

// true when this user sent the feedback (older items may have no user)
const isSender = (item, user) =>
  !!item.user &&
  (item.user._id || item.user).toString() === user._id.toString();

/**
 * @desc Submit feedback (requires authentication) and forward to site admin email
 */
const submitFeedback = async (req, res) => {
  try {
    const about = String(req.body.about || "").trim();
    const feedback = String(req.body.feedback || "").trim();

    if (!about || !feedback) {
      return res.status(400).json({
        success: false,
        message: "Please provide both 'about' and 'feedback' fields.",
      });
    }

    if (about.length > MAX_ABOUT || feedback.length > MAX_FEEDBACK) {
      return res.status(400).json({
        success: false,
        message: `Please keep your feedback under ${MAX_FEEDBACK} characters.`,
      });
    }

    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. Please log in to submit feedback.",
      });
    }

    const userId = req.user._id;
    const submitterName = req.user.name;
    const submitterEmail = req.user.email;

    // Save to database
    const newFeedback = await Feedback.create({
      user: userId,
      name: submitterName,
      email: submitterEmail,
      about,
      feedback,
    });

    // Forward to site admin email
    try {
      const siteAdminEmail =
        process.env.ADMIN_EMAIL ||
        process.env.SUPPORT_EMAIL ||
        "ejovwogfreeman007@gmail.com";

      await Email(
        siteAdminEmail,
        `New Website Feedback: ${about}`,
        "feedback.html",
        {
          NAME: submitterName,
          EMAIL: submitterEmail,
          ABOUT: about,
          FEEDBACK: feedback,
        },
      );
    } catch (mailErr) {
      console.error("Failed to forward feedback email to site admin:", mailErr);
    }

    return res.status(201).json({
      success: true,
      message: "Feedback submitted successfully. Thank you!",
      data: newFeedback,
    });
  } catch (err) {
    console.error("submitFeedback error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

/**
 * @desc Get all feedback (Admin only)
 */
const getAllFeedback = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only admins can view all feedback.",
      });
    }

    const feedbacks = await Feedback.find()
      .sort({ createdAt: -1 })
      .populate("user", "name email role profilePicture");

    return res.status(200).json({
      success: true,
      total: feedbacks.length,
      data: feedbacks,
    });
  } catch (err) {
    console.error("getAllFeedback error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * @desc Get logged-in user's feedback history
 */
const getMyFeedback = async (req, res) => {
  try {
    const feedbacks = await Feedback.find({ user: req.user._id }).sort({
      createdAt: -1,
    });

    return res.status(200).json({
      success: true,
      total: feedbacks.length,
      data: feedbacks,
    });
  } catch (err) {
    console.error("getMyFeedback error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * @desc Get a single feedback item by ID (Owner or Admin access)
 */
const getFeedbackById = async (req, res) => {
  try {
    const { id } = req.params;

    const feedbackItem = await Feedback.findById(id).populate(
      "user",
      "name email role profilePicture",
    );

    if (!feedbackItem) {
      return res.status(404).json({
        success: false,
        message: "Feedback not found",
      });
    }

    // Check authorization: Must be the creator or an admin
    if (!isSender(feedbackItem, req.user) && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this feedback",
      });
    }

    return res.status(200).json({
      success: true,
      data: feedbackItem,
    });
  } catch (err) {
    console.error("getFeedbackById error:", err);

    // Handle invalid MongoDB ObjectId format safely
    if (err.kind === "ObjectId") {
      return res.status(400).json({
        success: false,
        message: "Invalid feedback ID format",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

/**
 * @desc Update feedback (Owner can update their own feedback, or Admin)
 */
const updateFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    const { about, feedback } = req.body;

    const feedbackItem = await Feedback.findById(id);
    if (!feedbackItem) {
      return res
        .status(404)
        .json({ success: false, message: "Feedback not found" });
    }

    // Check authorization: Must be the creator of the feedback or an admin
    // (older items with no user can only be changed by an admin)
    if (!isSender(feedbackItem, req.user) && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this feedback",
      });
    }

    if (about !== undefined) {
      const next = String(about).trim();
      if (!next || next.length > MAX_ABOUT) {
        return res
          .status(400)
          .json({ success: false, message: "Please choose a topic." });
      }
      feedbackItem.about = next;
    }
    if (feedback !== undefined) {
      const next = String(feedback).trim();
      if (!next || next.length > MAX_FEEDBACK) {
        return res.status(400).json({
          success: false,
          message: `Please keep your feedback under ${MAX_FEEDBACK} characters.`,
        });
      }
      feedbackItem.feedback = next;
    }

    await feedbackItem.save();

    return res.status(200).json({
      success: true,
      message: "Feedback updated successfully",
      data: feedbackItem,
    });
  } catch (err) {
    console.error("updateFeedback error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * @desc Delete feedback (Owner or Admin)
 */
const deleteFeedback = async (req, res) => {
  try {
    const { id } = req.params;

    const feedbackItem = await Feedback.findById(id);
    if (!feedbackItem) {
      return res
        .status(404)
        .json({ success: false, message: "Feedback not found" });
    }

    // Check authorization: Must be owner or admin
    if (!isSender(feedbackItem, req.user) && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this feedback",
      });
    }

    await feedbackItem.deleteOne();

    return res.status(200).json({
      success: true,
      message: "Feedback deleted successfully",
    });
  } catch (err) {
    console.error("deleteFeedback error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

module.exports = {
  submitFeedback,
  getAllFeedback,
  getMyFeedback,
  getFeedbackById,
  updateFeedback,
  deleteFeedback,
};
```
