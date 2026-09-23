const Rating = require("../models/rating");
const Property = require("../models/property");
const Inspection = require("../models/inspection");
const Purchase = require("../models/purchase");
const Notification = require("../models/notification");
// ---------------------------
// 1️⃣ Create or Update Rating & Review
// ---------------------------
const createRating = async (req, res) => {
  try {
    const { propertyId, rating, comment } = req.body;
    const userId = req.user._id;

    // Fetch property to get the agent/owner
    const property = await Property.findById(propertyId);
    if (!property) {
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });
    }

    // Check if user has a paid inspection OR a purchase for this property
    const inspection = await Inspection.findOne({
      property: propertyId,
      user: userId,
      feePaid: true,
    });

    const purchase = await Purchase.findOne({
      property: propertyId,
      buyer: userId,
      feePaid: true,
    });

    if (!inspection && !purchase) {
      return res.status(400).json({
        success: false,
        message:
          "You must complete a paid inspection or make a purchase for this property before leaving a review.",
      });
    }

    // Determine the agent to assign the rating to (falls back to property owner if agent isn't set)
    const agentId = property.owner;

    // Check if user already reviewed this property
    let existingRating = await Rating.findOne({
      property: propertyId,
      user: userId,
    });

    let savedRating;
    let isUpdate = false;

    if (existingRating) {
      // 🔄 Update existing review
      isUpdate = true;
      existingRating.rating = rating;
      if (comment !== undefined) existingRating.comment = comment;
      // Refresh linkage if needed
      existingRating.inspection = inspection
        ? inspection._id
        : existingRating.inspection;
      existingRating.purchase = purchase
        ? purchase._id
        : existingRating.purchase;

      await existingRating.save();
      savedRating = existingRating;
    } else {
      // ➕ Create new review
      savedRating = await Rating.create({
        property: propertyId,
        user: userId,
        agent: agentId,
        inspection: inspection ? inspection._id : undefined,
        purchase: purchase ? purchase._id : undefined,
        rating,
        comment,
      });
    }

    // Notify agent/owner
    if (agentId) {
      await Notification.create({
        user: agentId,
        title: isUpdate ? "Property Review Updated" : "New Property Review",
        message: `A review for "${property.title}" was ${isUpdate ? "updated" : "posted"} (${rating} stars).`,
        meta: { ratingId: savedRating._id, propertyId },
      });
    }

    if (global.io) {
      global.io.emit("notification", {
        type: isUpdate ? "rating_updated" : "new_rating",
        title: isUpdate ? "Property Review Updated" : "New Property Review",
        message: `A review for "${property.title}" was ${isUpdate ? "updated" : "posted"}.`,
        propertyId,
      });
    }

    res.status(isUpdate ? 200 : 201).json({
      success: true,
      message: isUpdate
        ? "Review updated successfully."
        : "Rating and review submitted successfully.",
      rating: savedRating,
    });
  } catch (err) {
    console.error("createRating error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 2️⃣ Get All Ratings for a Property
// ---------------------------
const getPropertyRatings = async (req, res) => {
  try {
    const { propertyId } = req.params;

    const ratings = await Rating.find({ property: propertyId })
      .populate("user", "name email")
      .sort({ createdAt: -1 });

    // Calculate average rating
    const totalRatings = ratings.length;
    const averageRating =
      totalRatings > 0
        ? ratings.reduce((acc, curr) => acc + curr.rating, 0) / totalRatings
        : 0;

    res.json({
      success: true,
      totalRatings,
      averageRating: Number(averageRating.toFixed(1)),
      ratings,
    });
  } catch (err) {
    console.error("getPropertyRatings error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 3️⃣ Get All Ratings for an Agent
// ---------------------------
const getAgentRatings = async (req, res) => {
  try {
    const agentId = req.params.id || req.user._id;

    const ratings = await Rating.find({ agent: agentId })
      .populate("property", "title address")
      .populate("user", "name")
      .sort({ createdAt: -1 });

    const totalRatings = ratings.length;
    const averageRating =
      totalRatings > 0
        ? ratings.reduce((acc, curr) => acc + curr.rating, 0) / totalRatings
        : 0;

    res.json({
      success: true,
      totalRatings,
      averageRating: Number(averageRating.toFixed(1)),
      ratings,
    });
  } catch (err) {
    console.error("getAgentRatings error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 4️⃣ Update Rating
// ---------------------------
const updateRating = async (req, res) => {
  try {
    const { ratingId } = req.params;
    const { rating, comment } = req.body;
    const userId = req.user._id;

    const review = await Rating.findById(ratingId);
    if (!review) {
      return res
        .status(404)
        .json({ success: false, message: "Review not found" });
    }

    if (review.user.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to update this review",
      });
    }

    if (rating) review.rating = rating;
    if (comment !== undefined) review.comment = comment;

    await review.save();

    res.json({
      success: true,
      message: "Review updated successfully.",
      rating: review,
    });
  } catch (err) {
    console.error("updateRating error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ---------------------------
// 5️⃣ Delete Rating
// ---------------------------
const deleteRating = async (req, res) => {
  try {
    const { ratingId } = req.params;
    const userId = req.user._id;

    const review = await Rating.findById(ratingId);
    if (!review) {
      return res
        .status(404)
        .json({ success: false, message: "Review not found" });
    }

    if (
      review.user.toString() !== userId.toString() &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to delete this review",
      });
    }

    await review.deleteOne();

    res.json({
      success: true,
      message: "Review deleted successfully.",
    });
  } catch (err) {
    console.error("deleteRating error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createRating,
  getPropertyRatings,
  getAgentRatings,
  updateRating,
  deleteRating,
};
