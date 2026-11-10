const Property = require("../models/property");
const Notification = require("../models/notification");
const { uploadImages, uploadVideos } = require("../middlewares/cloudinary");

/**
 * Helper function to sanitize/filter internal property fields for non-owners/non-admins
 */
const sanitizePropertyForUser = (propObj, userId, userRole) => {
  if (!propObj) return propObj;

  const ownerId = propObj.owner?._id
    ? propObj.owner._id.toString()
    : propObj.owner?.toString();
  const isOwner = userId && ownerId && userId.toString() === ownerId;
  const isAdmin = userRole === "admin";

  // If not owner and not admin, strip internal sensitive fields
  if (!isOwner && !isAdmin) {
    delete propObj.adminNotes;
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
      escrowFee,
      address,
      propertyType,
      listingType,
      landSize: propertyType === "land" ? landSize : null,
      landUnit: propertyType === "land" ? landUnit : null,
      landCondition: propertyType === "land" ? landCondition : null,
      landDocTitle: propertyType === "land" ? landDocTitle : null,
      landType: propertyType === "land" ? landType : null,
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

    const sanitizedProps = props.map((p) =>
      sanitizePropertyForUser(p, userId, userRole),
    );

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

    const sanitizedProps = props.map((p) =>
      sanitizePropertyForUser(p, userId, userRole),
    );

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

      if (!isOwner && !isAdmin) {
        await Notification.create({
          user: ownerId,
          title: "Property Viewed",
          message: `Your property "${prop.title}" was viewed.`,
          meta: { propertyId: prop._id },
        });

        if (global.io)
          global.io.emit("notification", {
            type: "property_viewed",
            title: "Property Viewed",
            message: `Someone viewed "${prop.title}".`,
            propertyId: prop._id,
          });
      }
    }

    const userId = req.user?._id;
    const userRole = req.user?.role;
    const sanitizedProp = sanitizePropertyForUser(prop, userId, userRole);

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
    if (escrowFee !== undefined) prop.escrowFee = escrowFee;
    if (address !== undefined) prop.address = address;
    if (propertyType !== undefined) prop.propertyType = propertyType;
    if (listingType !== undefined) prop.listingType = listingType;
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
    } else {
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

    property.status = status;

    if (status === "rejected") {
      property.rejectionReason =
        reason || "Your property listing was rejected.";
    } else {
      // Clear rejectionReason when approved or set back to pending
      property.rejectionReason = undefined;
    }

    await property.save();

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
    property.flaggedAt = flagged ? new Date() : null;

    await property.save();

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

    const property = await Property.findById(propertyId).populate("owner");
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

    // Notify agent/owner privately (targeted socket instead of global broadcast)
    const ownerId = property.owner?._id || property.owner;
    if (ownerId) {
      const notificationMessage = `An admin left a note on your property "${property.title}": "${note}"`;

      const notif = await Notification.create({
        user: ownerId,
        title: "New Admin Note",
        message: notificationMessage,
        meta: { propertyId: property._id },
      });

      const ownerSocketId = global.onlineUsers?.get(ownerId.toString());
      if (ownerSocketId && global.io) {
        global.io.to(ownerSocketId).emit("notification", notif);
      }
    }

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
