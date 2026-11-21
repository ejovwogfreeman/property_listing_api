# 1. Building type for listings

The frontend now asks agents what kind of building they're listing. It sends a new field, `buildingType`, on create (`POST /property`, form data) and on edit (`PUT /property/:id`, JSON). It only sends it for buildings (`propertyType: "apartment"`), never for land.

**Values** (must match exactly):

| value          | shown as     |
| -------------- | ------------ |
| `self_contain` | Self-contain |
| `mini_flat`    | Mini flat    |
| `flat`         | Flat         |
| `bungalow`     | Bungalow     |
| `duplex`       | Duplex       |
| `terrace`      | Terrace      |
| `penthouse`    | Penthouse    |
| `commercial`   | Commercial   |

**What changes** (built from your latest commit, 4706d7c; replace both files in full):

- `models/property.js`: a new `buildingType` field (an enum of the values above, plus `null`; the default is `null`). Older listings simply have none, so no migration is needed.
- `controllers/property.js`:
  - `createProperty` saves `buildingType` for buildings, and `null` for land.
  - `updateProperty` updates it for buildings and clears it when a listing is land.
  - Nothing else changes. `getProperty` and the list endpoints already return every field.

**To test**

1. Add a building as an agent and pick "Duplex". The response and `GET /property/:id` show `buildingType: "duplex"`.
2. Edit it to "Flat". It saves.
3. Add a land listing. `buildingType` is `null`.
4. Send a value that isn't in the list (e.g. `"castle"`). It's rejected with a validation error.

---

## models/property.js

```js
const mongoose = require("mongoose");
const Counter = require("./counter");

const propertySchema = new mongoose.Schema(
  {
    code: {
      type: String,
      unique: true,
      sparse: true,
    },
    title: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    escrowFee: {
      type: Number,
    },
    address: {
      type: String,
      required: true,
    },
    images: {
      type: [String],
      default: [],
    },
    videos: {
      type: [String],
      default: [],
    },
    propertyType: {
      type: String,
      required: true,
      enum: ["land", "apartment", "duplex", "bungalow"],
    },
    listingType: {
      type: String,
      required: true,
      enum: ["rent", "sale"],
    },
    // the kind of building (buildings only; null for land and for older
    // listings made before this field existed)
    buildingType: {
      type: String,
      enum: [
        "self_contain",
        "mini_flat",
        "flat",
        "bungalow",
        "duplex",
        "terrace",
        "penthouse",
        "commercial",
        null,
      ],
      default: null,
    },
    landSize: {
      type: String,
    },
    landUnit: {
      type: String,
      enum: ["sqm", "acres", "hectares"],
    },
    landCondition: {
      type: String,
      enum: ["bare land", "fenced land", "land with structure"],
    },
    landDocTitle: {
      type: String,
      enum: [
        "Certificate of Ownership",
        "Governor's Consent",
        "Deed of Assignment",
      ],
    },
    landType: {
      type: String,
      enum: ["residential", "commercial", "agriculture"],
    },
    legalDocuments: {
      type: [String],
      default: [],
    },
    bedroom: {
      type: Number,
    },
    bathroom: {
      type: Number,
    },
    kitchen: {
      type: Number,
    },
    description: {
      type: String,
    },
    inspectionFee: {
      type: Number,
    },
    serviceCharge: {
      type: Number,
    },
    nearbyPlaces: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      // enum: ["pending", "approved", "rejected"],
      // sold: the buyer completed the handover (shown as "Rented" for rent
      // listings). set by syncPropertySold, never by hand
      enum: ["pending", "approved", "rejected", "sold"],
      default: "pending",
    },
    // 👈 ADD THIS FIELD TO YOUR SCHEMA
    rejectionReason: {
      type: String,
      default: null,
    },
    // --- BUG 8: Flagging Fields ---
    isFlagged: {
      type: Boolean,
      default: false,
    },
    flagReason: {
      type: String,
      default: null,
    },
    flaggedAt: {
      type: Date,
      default: null,
    },
    // --- BUG 9: Admin Notes ---
    adminNotes: [
      {
        note: { type: String, required: true },
        author: {
          _id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          name: { type: String },
        },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    // --- BUG 10: Status History ---
    statusHistory: [
      {
        status: { type: String, required: true },
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      },
    ],
    owner: {
      _id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      name: {
        type: String,
        required: true,
      },
      profilePicture: {
        type: [String],
        default: [],
      },
      isVerified: {
        type: Boolean,
        default: false,
      },
      rating: {
        type: Number,
        default: 0,
      },
      totalListings: {
        type: Number,
        default: 0,
      },
    },
  },
  { timestamps: true },
);

// --- PRE-SAVE HOOK: Auto-generate Code & Track Status History ---
propertySchema.pre("save", async function (next) {
  try {
    if (!this.code) {
      // atomic counter: each call gets the next number, even when two
      // properties are saved at the same moment
      const counter = await Counter.findOneAndUpdate(
        { _id: "property" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true },
      );
      this.code = `PROP-${String(counter.seq).padStart(4, "0")}`;
    }
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model("Property", propertySchema);
```

## controllers/property.js

```js
const Property = require("../models/property.js");
const User = require("../models/user");
const Notification = require("../models/notification");
const { uploadImages, uploadVideos } = require("../middlewares/cloudinary");

const { calculatePlatformFee } = require("../middlewares/platformFee");

const {
  stopAdsForProperty,
  pauseAdsForProperty,
} = require("../middlewares/adBilling");

const Purchase = require("../models/purchase");

// A buyer has paid (or their payment is under review) for these
const TAKEN_STATUSES = [
  "property_payment_made",
  "handover_requested",
  "handover_scheduled",
  "handover_rescheduled",
  "handover_confirmed",
  "handover_completed",
  "funds_released",
];

// Ids of properties another buyer can no longer pay for
const getTakenPropertyIds = async (propertyIds) => {
  const filter = {
    $or: [{ holdsProperty: true }, { status: { $in: TAKEN_STATUSES } }],
  };
  if (propertyIds) filter.property = { $in: propertyIds };
  const ids = await Purchase.distinct("property", filter);
  return new Set(ids.map((id) => id.toString()));
};

/**
 * Helper function to sanitize/filter internal property fields for non-owners/non-admins
 */
// const sanitizePropertyForUser = (propObj, userId, userRole) => {
//   if (!propObj) return propObj;

//   const ownerId = propObj.owner?._id
//     ? propObj.owner._id.toString()
//     : propObj.owner?.toString();
//   const isOwner = userId && ownerId && userId.toString() === ownerId;
//   const isAdmin = userRole === "admin";

//   // If not owner and not admin, strip internal sensitive fields
//   if (!isOwner && !isAdmin) {
//     delete propObj.adminNotes;
//     delete propObj.flagReason;
//     delete propObj.statusHistory;
//     delete propObj.rejectionReason;
//   }
//   return propObj;
// };

const sanitizePropertyForUser = (propObj, userId, userRole) => {
  if (!propObj) return propObj;

  const ownerId = propObj.owner?._id
    ? propObj.owner._id.toString()
    : propObj.owner?.toString();

  const isOwner = userId && ownerId && userId.toString() === ownerId;
  const isAdmin = userRole === "admin";

  // 1. adminNotes are STRICTLY for admins only (even the owner cannot see them)
  if (!isAdmin) {
    delete propObj.adminNotes;
  }

  // 2. Strip other internal audit/dispute fields for anyone who isn't the owner or admin
  if (!isOwner && !isAdmin) {
    delete propObj.flagReason;
    delete propObj.statusHistory;
    delete propObj.rejectionReason;
  }

  return propObj;
};

/**
 * @desc Create a new property
 */
const createProperty = async (req, res) => {
  try {
    const {
      title,
      description,
      price,
      escrowFee,
      address,
      propertyType,
      listingType,
      buildingType,
      landSize,
      landUnit,
      landCondition,
      landDocTitle,
      landType,
      bedroom,
      bathroom,
      kitchen,
      inspectionFee,
      serviceCharge,
      nearbyPlaces,
      ownerId,
    } = req.body;

    const loggedInUser = req.user;
    let targetOwnerUser = loggedInUser;

    if (loggedInUser.role === "admin" && ownerId) {
      const targetAgent = await User.findById(ownerId);
      if (!targetAgent) {
        return res.status(404).json({
          success: false,
          message: "Target agent user not found.",
        });
      }
      targetOwnerUser = targetAgent;
    }

    const owner = {
      _id: targetOwnerUser._id,
      name: targetOwnerUser.name,
      profilePicture: targetOwnerUser.profilePicture || null,
      isVerified: targetOwnerUser.isVerified || false,
      rating: targetOwnerUser.rating || 0,
      totalListings: targetOwnerUser.totalListings || 0,
    };

    const images = req.files?.images
      ? await uploadImages(req.files.images)
      : [];

    const legalDocuments = req.files?.legalDocuments
      ? await uploadImages(req.files.legalDocuments)
      : [];

    const videos = req.files?.videos
      ? await uploadVideos(req.files.videos)
      : [];

    const prop = await Property.create({
      title,
      description,
      price,
      // ignore any escrowFee in the request: the server works it out
      escrowFee: calculatePlatformFee(price, listingType),
      address,
      propertyType,
      listingType,
      landSize: propertyType === "land" ? landSize : null,
      landUnit: propertyType === "land" ? landUnit : null,
      landCondition: propertyType === "land" ? landCondition : null,
      landDocTitle: propertyType === "land" ? landDocTitle : null,
      landType: propertyType === "land" ? landType : null,
      buildingType: propertyType !== "land" ? buildingType || null : null,
      legalDocuments: legalDocuments,
      bedroom: propertyType !== "land" ? bedroom : null,
      bathroom: propertyType !== "land" ? bathroom : null,
      kitchen: propertyType !== "land" ? kitchen : null,
      inspectionFee,
      serviceCharge,
      nearbyPlaces: nearbyPlaces || [],
      images,
      videos,
      owner,
    });

    await Notification.create({
      user: targetOwnerUser._id,
      title: "Property Created",
      message: `Your property "${title}" was created successfully.`,
      meta: { propertyId: prop._id },
    });

    if (global.io) {
      global.io.emit("notification", {
        type: "property_created",
        title: "New Property Listed",
        message: `New property "${title}" just got listed.`,
        propertyId: prop._id,
      });
    }

    return res.status(201).json({ success: true, property: prop });
  } catch (err) {
    console.error("createProperty error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @desc Get all properties
 */
const getAllProperties = async (req, res) => {
  try {
    const props = await Property.find().sort({ createdAt: -1 }).lean();

    const userId = req.user?._id;
    const userRole = req.user?.role;

    const taken = await getTakenPropertyIds();
    const sanitizedProps = props.map((p) => ({
      ...sanitizePropertyForUser(p, userId, userRole),
      isTaken: taken.has(p._id.toString()),
    }));

    res.json({ success: true, properties: sanitizedProps });
  } catch (err) {
    console.error("listProperties error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @desc Get all properties for a specific agent
 */
const getAgentProperties = async (req, res) => {
  try {
    const requestedAgentId = req.params.id;
    const props = await Property.find({
      "owner._id": requestedAgentId,
    }).lean();

    const userId = req.user?._id;
    const userRole = req.user?.role;

    const taken = await getTakenPropertyIds(props.map((p) => p._id));
    const sanitizedProps = props.map((p) => ({
      ...sanitizePropertyForUser(p, userId, userRole),
      isTaken: taken.has(p._id.toString()),
    }));

    res.json({
      success: true,
      count: sanitizedProps.length,
      properties: sanitizedProps,
    });
  } catch (err) {
    console.error("getAgentProperties error:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/**
 * @desc Get single property
 */
const getProperty = async (req, res) => {
  try {
    const prop = await Property.findById(req.params.id)
      .populate("owner", "name email phoneNumber profilePicture")
      .lean();

    if (!prop)
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });

    if (req.user && req.user._id) {
      const viewerId = req.user._id.toString();
      const viewerRole = req.user.role;

      const ownerId = prop.owner?._id
        ? prop.owner._id.toString()
        : prop.owner?.toString();

      const isOwner = viewerId === ownerId;
      const isAdmin = viewerRole === "admin";

      // a view is not saved as a notification (one per view filled every
      // agent's notifications), and the live event goes to the owner only,
      // not to everyone connected
      if (!isOwner && !isAdmin && global.io && ownerId) {
        global.io.to(ownerId).emit("notification", {
          type: "property_viewed",
          title: "Property Viewed",
          message: `Someone viewed "${prop.title}".`,
          propertyId: prop._id,
        });
      }
    }

    const userId = req.user?._id;
    const userRole = req.user?.role;
    const taken = await getTakenPropertyIds([prop._id]);
    const sanitizedProp = {
      ...sanitizePropertyForUser(prop, userId, userRole),
      isTaken: taken.has(prop._id.toString()),
    };

    res.json({ success: true, property: sanitizedProp });
  } catch (err) {
    console.error("getProperty error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: err.message });
  }
};

/**
 * @desc Update property (Automatically resets rejected properties back to pending)
 */
const updateProperty = async (req, res) => {
  try {
    const prop = await Property.findById(req.params.id);
    if (!prop) {
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });
    }

    if (prop.status === "sold") {
      return res.status(400).json({
        success: false,
        message:
          "This property has been sold, so it can't be edited. To list it again, create a new property.",
      });
    }

    if (
      prop.owner._id.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    const {
      title,
      description,
      price,
      escrowFee,
      address,
      propertyType,
      listingType,
      buildingType,
      landSize,
      landUnit,
      landCondition,
      landDocTitle,
      landType,
      bedroom,
      bathroom,
      kitchen,
      inspectionFee,
      serviceCharge,
      nearbyPlaces,
    } = req.body;

    if (title !== undefined) prop.title = title;
    if (description !== undefined) prop.description = description;
    if (price !== undefined) prop.price = price;
    // if (escrowFee !== undefined) prop.escrowFee = escrowFee;
    // it's worked out below, after the price and listing type are updated
    if (address !== undefined) prop.address = address;
    if (propertyType !== undefined) prop.propertyType = propertyType;
    if (listingType !== undefined) prop.listingType = listingType;
    // keep the platform fee in step with the (possibly new) price and listing type
    prop.escrowFee = calculatePlatformFee(prop.price, prop.listingType);
    if (inspectionFee !== undefined) prop.inspectionFee = inspectionFee;
    if (serviceCharge !== undefined) prop.serviceCharge = serviceCharge;

    if (nearbyPlaces !== undefined) {
      try {
        prop.nearbyPlaces =
          typeof nearbyPlaces === "string"
            ? JSON.parse(nearbyPlaces)
            : nearbyPlaces;
      } catch (e) {
        prop.nearbyPlaces =
          typeof nearbyPlaces === "string"
            ? nearbyPlaces.split(",").map((s) => s.trim())
            : nearbyPlaces;
      }
    }

    const activePropertyType = propertyType || prop.propertyType;

    if (activePropertyType === "land") {
      if (landSize !== undefined) prop.landSize = landSize;
      if (landUnit !== undefined) prop.landUnit = landUnit;
      if (landCondition !== undefined) prop.landCondition = landCondition;
      if (landDocTitle !== undefined) prop.landDocTitle = landDocTitle;
      if (landType !== undefined) prop.landType = landType;

      prop.bedroom = null;
      prop.bathroom = null;
      prop.kitchen = null;
      prop.buildingType = null;
    } else {
      if (buildingType !== undefined) prop.buildingType = buildingType || null;
      if (bedroom !== undefined) prop.bedroom = bedroom;
      if (bathroom !== undefined) prop.bathroom = bathroom;
      if (kitchen !== undefined) prop.kitchen = kitchen;

      prop.landSize = null;
      prop.landUnit = null;
      prop.landCondition = null;
      prop.landDocTitle = null;
      prop.landType = null;
    }

    if (req.files?.images) {
      const newImages = await uploadImages(req.files.images);
      prop.images.push(...newImages);
    }

    if (req.files?.legalDocuments) {
      const newLegalDocs = await uploadImages(req.files.legalDocuments);
      prop.legalDocuments.push(...newLegalDocs);
    }

    if (req.files?.videos) {
      const newVideos = await uploadVideos(req.files.videos);
      if (newVideos && newVideos.length > 0) {
        prop.videos.push(...newVideos);
      }
    }

    // If listing was rejected, editing resets it to pending and clears rejectionReason
    if (prop.status === "rejected") {
      prop.status = "pending";
      prop.rejectionReason = undefined;
    }

    await prop.save();

    await Notification.create({
      user: prop.owner._id,
      title: "Property Updated",
      message: `Your property "${prop.title}" was updated successfully.`,
      meta: { propertyId: prop._id },
    });

    if (global.io) {
      global.io.emit("notification", {
        type: "property_updated",
        title: "Property Updated",
        message: `Property "${prop.title}" was updated.`,
        propertyId: prop._id,
      });
    }

    res.status(200).json({ success: true, property: prop });
  } catch (err) {
    console.error("updateProperty error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @desc Delete property
 */
const deleteProperty = async (req, res) => {
  try {
    const prop = await Property.findById(req.params.id);
    if (!prop)
      return res
        .status(404)
        .json({ success: false, message: "Property not found" });

    if (
      prop.owner.toString() !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    if (prop.status === "sold") {
      return res.status(400).json({
        success: false,
        message:
          "This property has been sold, so it can't be deleted. The buyer's transaction still refers to it.",
      });
    }

    // stop any ad on it first, so its unused days go to the agent's ad credit
    await stopAdsForProperty(prop._id, "property_deleted");

    await prop.deleteOne();

    await Notification.create({
      user: prop.owner,
      title: "Property Deleted",
      message: `Your property "${prop.title}" was deleted.`,
      meta: { propertyId: prop._id },
    });

    if (global.io)
      global.io.emit("notification", {
        type: "property_deleted",
        title: "Property Deleted",
        message: `Property "${prop.title}" has been deleted.`,
        propertyId: prop._id,
      });

    res.json({ success: true, message: "Property deleted successfully" });
  } catch (err) {
    console.error("deleteProperty error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @desc Change property status (Admin only)
 */
const changePropertyStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    const validStatuses = ["pending", "approved", "rejected"];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Status must be one of: ${validStatuses.join(", ")}`,
      });
    }

    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only admins can update property status.",
      });
    }

    const property = await Property.findById(id);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    if (property.status === "sold") {
      return res.status(400).json({
        success: false,
        message:
          "This property has been sold. Its status is set by the purchase and can't be changed here.",
      });
    }

    property.status = status;

    if (status === "rejected") {
      property.rejectionReason =
        reason || "Your property listing was rejected.";
    } else {
      // Clear rejectionReason when approved or set back to pending
      property.rejectionReason = undefined;
    }

    // await property.save();

    // let notificationMessage = `Your property "${property.title}" has been ${status}.`;
    await property.save();

    // ads only run on approved listings: a rejected one stops (unused days to
    // ad credit); one sent back to review is paused until it's approved again
    if (status === "rejected") {
      await stopAdsForProperty(property._id, "property_rejected");
    } else if (status === "pending") {
      await pauseAdsForProperty(property._id);
    }

    let notificationMessage = `Your property "${property.title}" has been ${status}.`;

    if (status === "rejected" && property.rejectionReason) {
      notificationMessage += ` Reason: ${property.rejectionReason}`;
    }

    await Notification.create({
      user: property.owner,
      title: `Property ${status.charAt(0).toUpperCase() + status.slice(1)}`,
      message: notificationMessage,
      meta: { propertyId: property._id },
    });

    if (global.io) {
      global.io.emit("notification", {
        type: `property_${status}`,
        title: `Property ${status.charAt(0).toUpperCase() + status.slice(1)}`,
        message: notificationMessage,
        propertyId: property._id,
      });
    }

    return res.status(200).json({
      success: true,
      message: `Property status successfully updated to '${status}'`,
      data: property,
    });
  } catch (err) {
    console.error("changePropertyStatus error:", err);

    if (err.kind === "ObjectId") {
      return res.status(400).json({
        success: false,
        message: "Invalid property ID format",
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
 * @desc Flag or unflag a property listing (Admin only)
 */
const flagProperty = async (req, res) => {
  try {
    const { id } = req.params;
    const { flagged, reason } = req.body;

    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only admins can flag property listings.",
      });
    }

    if (typeof flagged !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "The 'flagged' field must be a boolean (true or false).",
      });
    }

    const property = await Property.findById(id);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    property.isFlagged = flagged;
    property.flagReason = flagged ? reason || "No reason provided" : null;
    // property.flaggedAt = flagged ? new Date() : null;

    // await property.save();

    property.flaggedAt = flagged ? new Date() : null;

    await property.save();

    // a flagged listing can't carry an ad: it stops, unused days to ad credit
    if (flagged) {
      await stopAdsForProperty(property._id, "property_flagged");
    }

    return res.status(200).json({
      success: true,
      message: flagged
        ? "Property successfully flagged"
        : "Property unflagged successfully",
      property,
    });
  } catch (err) {
    console.error("flagProperty error:", err);

    if (err.kind === "ObjectId") {
      return res.status(400).json({
        success: false,
        message: "Invalid property ID format",
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
 * @desc Add an admin note to a property listing & notify the agent privately
 */
// const addAdminNote = async (req, res) => {
//   try {
//     const { propertyId } = req.params;
//     const { note } = req.body;

//     if (!note || !note.trim()) {
//       return res.status(400).json({
//         success: false,
//         message: "Note content cannot be empty.",
//       });
//     }

//     if (req.user.role !== "admin") {
//       return res.status(403).json({
//         success: false,
//         message: "Access denied. Only admins can add notes.",
//       });
//     }

//     const property = await Property.findById(propertyId).populate("owner");
//     if (!property) {
//       return res.status(404).json({
//         success: false,
//         message: "Property not found",
//       });
//     }

//     const newNote = {
//       note,
//       author: {
//         _id: req.user._id,
//         name: req.user.name,
//       },
//       createdAt: new Date(),
//     };

//     property.adminNotes.push(newNote);
//     await property.save();

//     const savedNote = property.adminNotes[property.adminNotes.length - 1];

//     // Notify agent/owner privately (targeted socket instead of global broadcast)
//     const ownerId = property.owner?._id || property.owner;
//     if (ownerId) {
//       const notificationMessage = `An admin left a note on your property "${property.title}": "${note}"`;

//       const notif = await Notification.create({
//         user: ownerId,
//         title: "New Admin Note",
//         message: notificationMessage,
//         meta: { propertyId: property._id },
//       });

//       const ownerSocketId = global.onlineUsers?.get(ownerId.toString());
//       if (ownerSocketId && global.io) {
//         global.io.to(ownerSocketId).emit("notification", notif);
//       }
//     }

//     return res.status(200).json({
//       success: true,
//       note: savedNote,
//     });
//   } catch (err) {
//     console.error("addAdminNote error:", err);
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };

/**
 * @desc Add an admin note to a property listing (Internal admin log only)
 * @route POST /api/properties/:propertyId/notes
 */
const addAdminNote = async (req, res) => {
  try {
    const { propertyId } = req.params;
    const { note } = req.body;

    if (!note || !note.trim()) {
      return res.status(400).json({
        success: false,
        message: "Note content cannot be empty.",
      });
    }

    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only admins can add notes.",
      });
    }

    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    const newNote = {
      note,
      author: {
        _id: req.user._id,
        name: req.user.name,
      },
      createdAt: new Date(),
    };

    property.adminNotes.push(newNote);
    await property.save();

    const savedNote = property.adminNotes[property.adminNotes.length - 1];

    // NOTE: Notifications and socket events have been completely removed.
    // Admin notes remain strictly internal for dispute logging.

    return res.status(200).json({
      success: true,
      note: savedNote,
    });
  } catch (err) {
    console.error("addAdminNote error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @desc Update an existing admin note
 */
const updateAdminNote = async (req, res) => {
  try {
    const { propertyId, noteId } = req.params;
    const { note } = req.body;

    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only admins can update notes.",
      });
    }

    if (!note || !note.trim()) {
      return res.status(400).json({
        success: false,
        message: "Note content cannot be empty.",
      });
    }

    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    const targetNote = property.adminNotes.id(noteId);
    if (!targetNote) {
      return res.status(404).json({
        success: false,
        message: "Admin note not found",
      });
    }

    targetNote.note = note;
    await property.save();

    return res.status(200).json({
      success: true,
      note: targetNote,
    });
  } catch (err) {
    console.error("updateAdminNote error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @desc Delete an admin note
 */
const deleteAdminNote = async (req, res) => {
  try {
    const { propertyId, noteId } = req.params;

    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only admins can delete notes.",
      });
    }

    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    const targetNote = property.adminNotes.id(noteId);
    if (!targetNote) {
      return res.status(404).json({
        success: false,
        message: "Admin note not found",
      });
    }

    property.adminNotes.pull(noteId);
    await property.save();

    return res.status(200).json({
      success: true,
      message: "Admin note successfully deleted",
    });
  } catch (err) {
    console.error("deleteAdminNote error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createProperty,
  getAllProperties,
  getAgentProperties,
  getProperty,
  updateProperty,
  deleteProperty,
  changePropertyStatus,
  flagProperty,
  addAdminNote,
  updateAdminNote,
  deleteAdminNote,
};
```

---

# 2. Agent contact details on the public agent pages

**The problem:** `GET /user/agents` and `GET /user/agents/:id` don't need a login (the frontend now shows the agent list and agent profiles to visitors who aren't signed in). But both responses include every agent's **email** and **phone number**, so anyone can collect them straight from the API. That invites scraping and deals made off the platform, around escrow. `GET /user/agents/:id` also returns **riskLevel**, the admin's internal rating of the agent.

**The fix** (built from your latest commit, 4706d7c; replace both files in full):

- `routes/user.js`: the two routes now use `optionalAuth` (the same middleware `GET /property/:id` uses), so the controller knows whether someone is logged in. They stay public.
- `controllers/user.js`: one list of public fields for both endpoints (`AGENT_PUBLIC_FIELDS`), plus:
  - `email` and `phoneNumber` only when the request is from a logged-in user;
  - `riskLevel` only for admins.
  - Nothing else changes in this file.

**What the frontend expects:** visitors who aren't logged in get no email, phone or risk level; logged-in buyers and agents get email and phone; admins get everything as before (the admin property page reads the agent through `/user/agents/:id` with the admin's token).

**To test**

1. Logged out: `GET /user/agents` and `GET /user/agents/<id>` have no `email`, `phoneNumber` or `riskLevel`.
2. Logged in as a buyer: both include `email` and `phoneNumber`, but not `riskLevel`.
3. Logged in as an admin: `/user/agents/<id>` includes `riskLevel` too.
4. An expired or invalid token behaves like logged out (no error).

## routes/user.js

```js
// routes/user.js
const express = require("express");
const router = express.Router();
const multer = require("multer");

// Middlewares
const { optionalAuth, protect, authorize } = require("../middlewares/auth"); // middleware to get req.user from JWT
const trackActivity = require("../middlewares/trackActivity");
const {
  uploadProfilePicture,
  uploadOnboardingFiles,
} = require("../middlewares/upload");

const {
  getMe,
  updateProfile,
  changeProfilePicture,
  onboardAgent,
  getAllAgents,
  getAllUsers,
  getAgentProfile,
  onboardUser,
  upgradeUser,
  getUserProfile,
  updateAgentRiskLevel,
  updateAgentVerification,
  moderateUserAccount,
} = require("../controllers/user");

// ===============================
// USER ROUTES
// ===============================

// Get logged-in user
router.get("/me", protect, trackActivity, getMe);

// Update profile (normal users only)
router.put("/update-profile", protect, trackActivity, updateProfile);

// Change profile picture (all users)
router.post(
  "/change-profile-picture",
  protect,
  trackActivity,
  uploadProfilePicture,
  changeProfilePicture,
);

// PUT or PATCH endpoint to onboard the agent
router.patch(
  "/onboard-agent",
  protect,
  authorize("agent"),
  trackActivity,
  uploadOnboardingFiles,
  onboardAgent,
);

// PUT or PATCH endpoint to onboard the user
router.patch(
  "/onboard-user",
  protect,
  trackActivity,
  uploadOnboardingFiles,
  onboardUser,
);

// PUT or PATCH endpoint to upgrade user
router.patch("/upgrade-user", protect, trackActivity, upgradeUser);

// Get all agents (public route; a logged-in user also gets contact details)
router.get("/agents", optionalAuth, getAllAgents);

// Get all users (admin only)
router.get("/users", protect, authorize("admin"), trackActivity, getAllUsers);

// Get agent profile (public route; a logged-in user also gets contact details)
router.get("/agents/:id", optionalAuth, getAgentProfile);

// Get user profile (protected)
router.get("/users/:id", protect, trackActivity, getUserProfile);

// PATCH: Update an agent's risk level (Admin only)
router.patch("/agents/:id/risk", protect, trackActivity, updateAgentRiskLevel);

// Admin only routes
router.patch(
  "/agents/:id/verification",
  protect,
  authorize("admin"),
  trackActivity,
  updateAgentVerification,
);
router.patch(
  "/users/:id/moderate",
  protect,
  authorize("admin"),
  trackActivity,
  moderateUserAccount,
);

module.exports = router;
```

## controllers/user.js

```js
const User = require("../models/user");
const Notification = require("../models/notification");
const jwt = require("jsonwebtoken");
const { uploadImages } = require("../middlewares/cloudinary");

/**
 * @desc Get logged-in user
 */
const getMe = async (req, res) => {
  try {
    const authHeader = req.header("Authorization");
    if (!authHeader)
      return res.status(401).json({ message: "No token provided" });

    const token = authHeader.replace("Bearer ", "").trim();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      success: true,
      user,
    });
  } catch (err) {
    console.error("GetMe error:", err.message);

    if (err.name === "TokenExpiredError")
      return res.status(401).json({ message: "Token expired" });

    res.status(401).json({ message: "Invalid or missing token" });
  }
};

/**
 * @desc Update user profile info
 */
const updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const { name, address, phoneNumber } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Only allow normal users to update
    // if (user.isGoogleUser) {
    //   return res
    //     .status(403)
    //     .json({ message: "Google users cannot update these fields" });
    // }

    // all users (both google and non google users can now update these fields)
    // Update allowed fields
    if (name) user.name = name;
    if (address) user.address = address;
    if (phoneNumber) user.phoneNumber = phoneNumber;

    await user.save();

    // ---------------------------
    // NOTIFY ADMINS
    // ---------------------------
    const admins = await User.find({ role: "admin" });

    for (const admin of admins) {
      const notif = await Notification.create({
        user: admin._id,
        title: "User Profile Updated",
        message: `${user.name} updated their profile information`,
        meta: {
          updatedFields: { name, address, phoneNumber },
          userId: user._id,
        },
      });

      const adminSocketId = global.onlineUsers?.get(admin._id.toString());
      if (adminSocketId && global.io) {
        global.io.to(adminSocketId).emit("notification", notif);
      }
    }

    // Sanitize user object to remove password before sending response
    const userResponse = user.toObject();
    delete userResponse.password;

    res.json({ message: "User updated successfully", user: userResponse });
  } catch (err) {
    console.error("Update user error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

/**
 * @desc Change user profile picture
 */
const changeProfilePicture = async (req, res) => {
  try {
    const userId = req.user._id;

    if (!req.files) {
      return res.status(400).json({ message: "Profile picture is required" });
    }

    const imageUrl = req.files?.images
      ? await uploadImages(req.files.images)
      : [];

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.profilePicture = imageUrl;
    await user.save();

    await Notification.create({
      user: user._id,
      title: "Profile Updated",
      message: `${user.name} updated their profile picture`,
      meta: { userId },
    });

    if (global.io) {
      global.io.to("admin").emit("notification", {
        type: "profile_picture_updated",
        title: "Profile Picture Updated",
        message: `${user.name} changed their profile picture`,
        userId,
      });
    }

    res.json({
      message: "Profile picture updated successfully",
      profilePicture: imageUrl,
    });
  } catch (err) {
    console.error("changeProfilePicture error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

/**
 * @desc Onboard an agent by submitting professional details and document/ID files
 */
// const onboardAgent = async (req, res) => {
//   try {
//     const userId = req.user._id;
//     const {
//       phoneNumber,
//       about,
//       yearsOfExperience,
//       serviceArea,
//       languages,
//       businessName,
//       licenseNumber,
//       officeAddress,
//       socialLinkOrWebsite,
//     } = req.body;

//     const user = await User.findById(userId);
//     if (!user) return res.status(404).json({ message: "User not found" });

//     if (user.role !== "agent") {
//       return res.status(403).json({
//         message: "Only users with the agent role can complete onboarding",
//       });
//     }

//     const governmentIdUrls = req.files?.governmentId
//       ? await uploadImages(req.files.governmentId)
//       : [];

//     const licenseDocUrls = req.files?.licenseDoc
//       ? await uploadImages(req.files.licenseDoc)
//       : [];

//     if (phoneNumber !== undefined) user.phoneNumber = phoneNumber;
//     if (about !== undefined) user.about = about;
//     if (yearsOfExperience !== undefined)
//       user.yearsOfExperience = yearsOfExperience;

//     if (serviceArea !== undefined) {
//       try {
//         user.serviceArea =
//           typeof serviceArea === "string"
//             ? JSON.parse(serviceArea)
//             : serviceArea;
//       } catch (e) {
//         user.serviceArea =
//           typeof serviceArea === "string"
//             ? serviceArea.split(",").map((s) => s.trim())
//             : serviceArea;
//       }
//     }

//     if (languages !== undefined) {
//       try {
//         user.languages =
//           typeof languages === "string" ? JSON.parse(languages) : languages;
//       } catch (e) {
//         user.languages =
//           typeof languages === "string"
//             ? languages.split(",").map((l) => l.trim())
//             : languages;
//       }
//     }

//     if (businessName !== undefined) user.businessName = businessName;
//     if (licenseNumber !== undefined) user.licenseNumber = licenseNumber;
//     if (officeAddress !== undefined) user.officeAddress = officeAddress;
//     if (socialLinkOrWebsite !== undefined)
//       user.socialLinkOrWebsite = socialLinkOrWebsite;

//     user.governmentId = governmentIdUrls;
//     user.licenseDoc = licenseDocUrls;
//     user.isOnboarding = true;
//     user.onboardedAt = Date.now();
//     user.verificationStatus = "pending";
//     -(await user.save());

//     const admins = await User.find({ role: "admin" });
//     for (const admin of admins) {
//       const notif = await Notification.create({
//         user: admin._id,
//         title: "Agent Onboarded",
//         message: `${user.name} submitted their agent onboarding details`,
//         meta: { userId: user._id },
//       });

//       const adminSocketId = global.onlineUsers?.get(admin._id.toString());
//       if (adminSocketId && global.io) {
//         global.io.to(adminSocketId).emit("notification", notif);
//       }
//     }

//     // Sanitize user object
//     const userResponse = user.toObject();
//     delete userResponse.password;

//     return res.status(200).json({
//       success: true,
//       message: "Agent onboarding submitted successfully",
//       user: userResponse,
//     });
//   } catch (err) {
//     console.error("onboardAgent error:", err);
//     return res
//       .status(500)
//       .json({ message: "Server error", error: err.message });
//   }
// };

const onboardAgent = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      phoneNumber,
      about,
      yearsOfExperience,
      serviceArea,
      languages,
      businessName,
      licenseNumber,
      officeAddress,
      socialLinkOrWebsite,
    } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.role !== "agent") {
      return res.status(403).json({
        message: "Only users with the agent role can complete onboarding",
      });
    }

    // 1. Enforce submission/resubmission restriction rule
    const currentStatus = user.verificationStatus || "none";
    if (currentStatus === "pending" || currentStatus === "approved") {
      return res.status(400).json({
        success: false,
        message: `Cannot submit onboarding while status is '${currentStatus}'.`,
      });
    }

    // 2. File persistence: keep existing documents if no new files are uploaded
    const governmentIdUrls = req.files?.governmentId
      ? await uploadImages(req.files.governmentId)
      : user.governmentId;

    const licenseDocUrls = req.files?.licenseDoc
      ? await uploadImages(req.files.licenseDoc)
      : user.licenseDoc;

    if (phoneNumber !== undefined) user.phoneNumber = phoneNumber;
    if (about !== undefined) user.about = about;
    if (yearsOfExperience !== undefined)
      user.yearsOfExperience = yearsOfExperience;

    if (serviceArea !== undefined) {
      try {
        user.serviceArea =
          typeof serviceArea === "string"
            ? JSON.parse(serviceArea)
            : serviceArea;
      } catch (e) {
        user.serviceArea =
          typeof serviceArea === "string"
            ? serviceArea.split(",").map((s) => s.trim())
            : serviceArea;
      }
    }

    if (languages !== undefined) {
      try {
        user.languages =
          typeof languages === "string" ? JSON.parse(languages) : languages;
      } catch (e) {
        user.languages =
          typeof languages === "string"
            ? languages.split(",").map((l) => l.trim())
            : languages;
      }
    }

    if (businessName !== undefined) user.businessName = businessName;
    if (licenseNumber !== undefined) user.licenseNumber = licenseNumber;
    if (officeAddress !== undefined) user.officeAddress = officeAddress;
    if (socialLinkOrWebsite !== undefined)
      user.socialLinkOrWebsite = socialLinkOrWebsite;

    user.governmentId = governmentIdUrls;
    user.licenseDoc = licenseDocUrls;
    user.isOnboarding = true;
    user.onboardedAt = Date.now();
    user.verificationStatus = "pending";

    // Clear old rejection notes when re-submitting from a rejected state
    user.verificationNote = undefined;

    await user.save();

    const admins = await User.find({ role: "admin" });
    for (const admin of admins) {
      const notif = await Notification.create({
        user: admin._id,
        title: "Agent Onboarded",
        message: `${user.name} submitted their agent onboarding details`,
        meta: { userId: user._id },
      });

      const adminSocketId = global.onlineUsers?.get(admin._id.toString());
      if (adminSocketId && global.io) {
        global.io.to(adminSocketId).emit("notification", notif);
      }
    }

    // Sanitize user object
    const userResponse = user.toObject();
    delete userResponse.password;

    return res.status(200).json({
      success: true,
      message: "Agent onboarding submitted successfully",
      user: userResponse,
    });
  } catch (err) {
    console.error("onboardAgent error:", err);
    return res
      .status(500)
      .json({ message: "Server error", error: err.message });
  }
};

/**
 * @desc Get all agents (Public route)
 */
// const getAllAgents = async (req, res) => {
//   try {
//     const agents = await User.find({ role: "agent" }).select(
//       "name email phoneNumber profilePicture isVerified about yearsOfExperience serviceArea languages businessName licenseNumber officeAddress socialLinkOrWebsite isOnboarding rating totalListings createdAt",
//     );

//     return res.status(200).json({
//       success: true,
//       message: "Agents fetched successfully",
//       total: agents.length,
//       data: agents,
//     });
//   } catch (error) {
//     console.error("getAllAgents error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: error.message,
//     });
//   }
// };

// What anyone (logged in or not) may see about an agent. Contact details
// are added for logged-in users only, so they can't be scraped from the
// public API; the risk level is the admin's own note and only admins get it.
const AGENT_PUBLIC_FIELDS =
  "name profilePicture isVerified verificationStatus about yearsOfExperience serviceArea languages businessName licenseNumber officeAddress socialLinkOrWebsite isOnboarding rating totalListings createdAt";

const agentFieldsFor = (viewer) => {
  let fields = AGENT_PUBLIC_FIELDS;
  if (viewer) fields += " email phoneNumber";
  if (viewer?.role === "admin") fields += " riskLevel";
  return fields;
};

const getAllAgents = async (req, res) => {
  try {
    const agents = await User.find({ role: "agent" }).select(
      agentFieldsFor(req.user),
    );

    return res.status(200).json({
      success: true,
      message: "Agents fetched successfully",
      total: agents.length,
      data: agents,
    });
  } catch (error) {
    console.error("getAllAgents error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * @desc Get all users (Admin/General route - password excluded)
 */
const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select("-password");

    return res.status(200).json({
      success: true,
      message: "All users fetched successfully",
      total: users.length,
      data: users,
    });
  } catch (error) {
    console.error("getAllUsers error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/**
 * @desc Get a particular agent by ID (Public route)
 */
// const getAgentProfile = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const agent = await User.findOne({ _id: id, role: "agent" }).select(
//       "name email phoneNumber profilePicture isVerified about yearsOfExperience serviceArea languages businessName licenseNumber officeAddress socialLinkOrWebsite isOnboarding rating totalListings createdAt",
//     );

//     if (!agent) {
//       return res.status(404).json({
//         success: false,
//         message: "Agent not found",
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       message: "Agent fetched successfully",
//       data: agent,
//     });
//   } catch (error) {
//     console.error("getAgentProfile error:", error);

//     if (error.kind === "ObjectId") {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid agent ID format",
//       });
//     }

//     return res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: error.message,
//     });
//   }
// };

// const getAgentProfile = async (req, res) => {
//   try {
//     const { id } = req.params;

//     const agent = await User.findOne({ _id: id, role: "agent" }).select(
//       "name email phoneNumber profilePicture isVerified about yearsOfExperience serviceArea languages businessName licenseNumber officeAddress socialLinkOrWebsite isOnboarding rating totalListings riskLevel createdAt",
//     );

//     if (!agent) {
//       return res.status(404).json({
//         success: false,
//         message: "Agent not found",
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       message: "Agent fetched successfully",
//       data: agent,
//     });
//   } catch (error) {
//     console.error("getAgentProfile error:", error);

//     if (error.kind === "ObjectId") {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid agent ID format",
//       });
//     }

//     return res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: error.message,
//     });
//   }
// };
const getAgentProfile = async (req, res) => {
  try {
    const { id } = req.params;

    const agent = await User.findOne({ _id: id, role: "agent" }).select(
      agentFieldsFor(req.user),
    );

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Agent not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Agent fetched successfully",
      data: agent,
    });
  } catch (error) {
    console.error("getAgentProfile error:", error);

    if (error.kind === "ObjectId") {
      return res.status(400).json({
        success: false,
        message: "Invalid agent ID format",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * @desc Complete standard user onboarding (sets isOnboarding to true)
 */
const onboardUser = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Verify user is a standard user
    if (user.role !== "user") {
      return res.status(403).json({
        message:
          "Only users with the standard user role can complete this onboarding",
      });
    }

    // anybody can now access this route
    // Only update isOnboarding to true
    user.isOnboarding = true;

    await user.save();

    // Sanitize user object to remove password
    const userResponse = user.toObject();
    delete userResponse.password;

    return res.status(200).json({
      success: true,
      message: "User onboarding completed successfully",
      user: userResponse,
    });
  } catch (err) {
    console.error("onboardUser error:", err);
    return res
      .status(500)
      .json({ message: "Server error", error: err.message });
  }
};

/**
 * @desc Upgrade user account role from 'user' to 'agent'
 */
const upgradeUser = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Check if user is already an agent
    if (user.role !== "user") {
      return res.status(400).json({
        success: false,
        message: "Your account is already an agent account",
      });
    }

    // Upgrade role to agent
    user.role = "agent";

    // Reset isOnboarding to false so they can proceed with filling out their agent profile/documents
    user.isOnboarding = false;

    await user.save();

    // Sanitize user object to remove password
    const userResponse = user.toObject();
    delete userResponse.password;

    return res.status(200).json({
      success: true,
      message:
        "Account upgraded to agent successfully. Please proceed with agent onboarding.",
      user: userResponse,
    });
  } catch (err) {
    console.error("upgrade User error:", err);
    return res
      .status(500)
      .json({ message: "Server error", error: err.message });
  }
};

/**
 * @desc Get user profile by ID (Public/Protected route)
 */
const getUserProfile = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findOne({ _id: id, role: "user" }).select(
      "name profilePicture address phoneNumber rating createdAt isOnboarding",
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User fetched successfully",
      data: user,
    });
  } catch (error) {
    console.error("getUserProfile error:", error);

    if (error.kind === "ObjectId") {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

/**
 * @desc Update an agent's risk level (Admin only)
 * @route PATCH /api/users/agents/:id/risk
 */
const updateAgentRiskLevel = async (req, res) => {
  try {
    const { id } = req.params;
    const { riskLevel } = req.body;

    // 1. Verify admin role
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only admins can update risk levels.",
      });
    }

    // 2. Validate riskLevel value matches schema enum
    const validLevels = ["none", "low", "medium", "high"];
    if (!validLevels.includes(riskLevel)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid risk level. Must be 'none', 'low', 'medium', or 'high'.",
      });
    }

    // 3. Find and update the agent
    const agent = await User.findById(id);
    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Agent not found",
      });
    }

    agent.riskLevel = riskLevel;
    await agent.save();

    return res.status(200).json({
      success: true,
      message: `Agent risk level successfully updated to '${riskLevel}'`,
      agent: {
        _id: agent._id,
        name: agent.name,
        email: agent.email,
        riskLevel: agent.riskLevel,
      },
    });
  } catch (err) {
    console.error("updateAgentRiskLevel error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 15. Approve or Reject Agent Verification
// const updateAgentVerification = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { status } = req.body; // "approved" or "rejected"

//     if (!["approved", "rejected"].includes(status)) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Invalid status value" });
//     }

//     const agent = await User.findOne({ _id: id, role: "agent" });
//     if (!agent)
//       return res
//         .status(404)
//         .json({ success: false, message: "Agent not found" });

//     agent.verificationStatus = status;
//     agent.isVerified = status === "approved";
//     // agent.onboardedAt = Date.now();
//     await agent.save();

//     return res
//       .status(200)
//       .json({ success: true, message: `Agent verification ${status}`, agent });
//   } catch (err) {
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };

const updateAgentVerification = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body; // "approved" or "rejected", optional reason

    if (!["approved", "rejected"].includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status value" });
    }

    const agent = await User.findOne({ _id: id, role: "agent" });
    if (!agent)
      return res
        .status(404)
        .json({ success: false, message: "Agent not found" });

    agent.verificationStatus = status;

    // NOTE: Intentionally leaving agent.isVerified untouched (it is for email confirmation)

    if (status === "rejected") {
      agent.verificationNote =
        reason || "Your onboarding verification was rejected.";
    } else if (status === "approved") {
      agent.verificationNote = undefined; // Clear any old rejection notes upon approval
    }

    await agent.save();

    // Send notification to the agent about the decision
    const notificationMessage =
      status === "approved"
        ? "Congratulations! Your agent onboarding verification has been approved."
        : `Your agent onboarding verification was rejected. Reason: ${agent.verificationNote}`;

    const notif = await Notification.create({
      user: agent._id,
      title: `Agent Verification ${status.charAt(0).toUpperCase() + status.slice(1)}`,
      message: notificationMessage,
      meta: { verificationStatus: status },
    });

    const agentSocketId = global.onlineUsers?.get(agent._id.toString());
    if (agentSocketId && global.io) {
      global.io.to(agentSocketId).emit("notification", notif);
    }

    const agentResponse = agent.toObject();
    delete agentResponse.password;

    return res.status(200).json({
      success: true,
      message: `Agent verification ${status}`,
      agent: agentResponse,
    });
  } catch (err) {
    console.error("updateAgentVerification error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 16. Suspend, Ban, or Flag User
const moderateUserAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, value } = req.body; // action: "suspend" | "ban" | "flag", value: boolean

    const user = await User.findById(id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    if (action === "suspend") user.isSuspended = value;
    if (action === "ban") user.isBanned = value;
    if (action === "flag") user.isFlagged = value;

    await user.save();
    return res
      .status(200)
      .json({ success: true, message: `User ${action} status updated`, user });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * One-time migration: Updates legacy submitted agents from "none" to "pending"
 */
const runAgentVerificationMigration = async () => {
  try {
    const result = await User.updateMany(
      { role: "agent", isOnboarding: true, verificationStatus: "none" },
      { $set: { verificationStatus: "pending" } },
    );
    if (result.modifiedCount > 0) {
      console.log(
        `[Migration] Successfully updated ${result.modifiedCount} legacy agent(s) to 'pending' status.`,
      );
    }
  } catch (err) {
    console.error(
      "[Migration] Error running agent verification migration:",
      err,
    );
  }
};

// Execute it automatically on server startup
runAgentVerificationMigration();

module.exports = {
  getMe,
  updateProfile,
  changeProfilePicture,
  onboardAgent,
  getAllAgents,
  getAllUsers,
  getAgentProfile,
  onboardUser,
  upgradeUser,
  getUserProfile,
  updateAgentRiskLevel,
  updateAgentVerification,
  moderateUserAccount,
};
```
