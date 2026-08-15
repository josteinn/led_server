const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const validNames = [
            "gøril", "kine", "helene", "eleanord", "may", "daniel", "ragnhild", "mathias", "emanuel", "tor", "ånen", "elisa",
            "marius", "robin", "emil", "benedicte", "amalie", "thea", "aurora", "haron", "mustafa", "hashi", "mia", "chun",
            "morten", "martin", "hanna", "yonas", "adrian", "joacim", "sharath", "chandra", "ebba", "sofie", "sander", "jostein",
            "brian", "alessandro", "monina", "konstanse", "adrian", "daniella", "kristine", "stian", "camacho", "lana", "rahim", "gøril",
            "mohammad", "ayman", "nina", "anders", "niklas", "william", "katarina", "wisdom", "natalie", "joshua"
        ];

// -----------------------------------------------------------------------------
// Name rate limiting
// -----------------------------------------------------------------------------

const NAME_COOLDOWN_MS = 10 * 1000; // 10 seconds

// Name -> timestamp when it was last accepted
const lastDisplayedName = new Map();

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const USER_KEY = "MM206";
const ESP_KEY = "RY644";
const RESET_KEY = "GA301";

// Maximum name length
const MAX_NAME_LENGTH = 10;

// -----------------------------------------------------------------------------
// Queue
// -----------------------------------------------------------------------------

let nextId = 1;

// Waiting names
const queue = [];

// Item currently being displayed by the ESP.
// It remains here until /completename is called.
let current = null;

// -----------------------------------------------------------------------------
// Named colors
// -----------------------------------------------------------------------------

const COLORS = {
    red:     "#ff0000",
    green:   "#00ff00",
    blue:    "#0000ff",
    yellow:  "#ffff00",
    cyan:    "#00ffff",
    magenta: "#ff00ff",
    white:   "#ffffff",
    orange:  "#ff8000",
    purple:  "#8000ff",
    pink:    "#ff0080"
};


// -----------------------------------------------------------------------------
// Convert a color supplied by the user to a normalized hex value.
//
// Accepts:
//
//   red
//   blue
//   #ff5500
//   ff5500
//
// Returns null if the color is invalid.
// -----------------------------------------------------------------------------

function parseColor(color) {

    color = String(color || "").trim().toLowerCase();

    // Named color
    if (COLORS[color]) {
        return COLORS[color];
    }

    // Hex color with # or without #
    if (/^#?[0-9a-f]{6}$/i.test(color)) {

        if (!color.startsWith("#")) {
            color = "#" + color;
        }

        return color;
    }

    return null;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function checkUserKey(req, res) {
    if (req.query.key.trim().toUpperCase() !== USER_KEY) {
        res.status(401).json({
            error: "invalid user key"
        });
        return false;
    }

    return true;
}

function checkEspKey(req, res) {
    if (req.query.key !== ESP_KEY) {
        res.status(401).json({
            error: "invalid ESP key"
        });
        return false;
    }

    return true;
}

// -----------------------------------------------------------------------------
// Add a name to the queue
//
// Example:
//
// /setname?key=MM206&name=peter&color=red
// -----------------------------------------------------------------------------

app.get("/setname", (req, res) => {

    if (!checkUserKey(req, res)) {
        return;
    }

    // -------------------------------------------------------------------------
    // Validate name
    // -------------------------------------------------------------------------

    const name = String(req.query.name || "").trim();

    if (!/^\p{L}{1,10}$/u.test(name)) {
        return res.status(400).json({
            error: "name must contain 1-10 letters"
        });
    }

    // -------------------------------------------------------------------------
    // Check if the name is allowed.
    // Comparison is case-insensitive.
    // -------------------------------------------------------------------------

    const normalizedName = name.toLocaleLowerCase("nb-NO");

    if (!validNames.includes(normalizedName)) {
        return res.status(400).json({
            error: `"${name}" is an unknown name`
        });
    }

    // -------------------------------------------------------------------------
    // Check name cooldown
    // -------------------------------------------------------------------------

    const now = Date.now();

    const lastDisplayed =
        lastDisplayedName.get(normalizedName);

    if (lastDisplayed !== undefined) {

        const elapsed = now - lastDisplayed;

        if (elapsed < NAME_COOLDOWN_MS) {

            const remainingSeconds = Math.ceil(
                (NAME_COOLDOWN_MS - elapsed) / 1000
            );

            return res.status(429).json({
                error: "this name was recently displayed or queued for display",
                retryAfterSeconds: remainingSeconds
            });
        }
    }

    // -------------------------------------------------------------------------
    // Parse color
    // -------------------------------------------------------------------------

    const colorInput =
        String(req.query.color || "").trim();

    const hexColor =
        parseColor(colorInput);

    if (hexColor === null) {
        return res.status(400).json({
            error: "invalid color",
            message: "Use a named color or a 6-digit hex color",
            examples: [
                "red",
                "blue",
                "#ff5500",
                "ff5500"
            ]
        });
    }

    // -------------------------------------------------------------------------
    // Request is valid.
    // Start the name cooldown.
    // -------------------------------------------------------------------------

    lastDisplayedName.set(
        normalizedName,
        now
    );

    const item = {
        id: nextId++,
        name: name,
        color: colorInput,
        hex: hexColor,
        createdAt: new Date().toISOString()
    };

    queue.push(item);

    console.log(
        "Queued:",
        item
    );

    res.json({
        success: true,
        message: "name queued",
        item,
        queueLength:
            queue.length +
            (current ? 1 : 0)
    });
});

//---------------------------------------------------------

app.get("/getname", (req, res) => {

    if (!checkEspKey(req, res)) {
        return;
    }

    // If the ESP is currently displaying something,
    // always return that same item.
    if (current !== null) {
        return res.json({
            available: true,
            item: current
        });
    }

    // Nothing currently active.
    if (queue.length === 0) {
        return res.json({
            available: false
        });
    }

    // Move the first queued item into "current".
    current = queue.shift();

    console.log("Now displaying:", current);

    res.json({
        available: true,
        item: current
    });
});

// -----------------------------------------------------------------------------
// ESP says it has completely displayed an item.
//
// Example:
//
// /completename?key=RY644&id=123
// -----------------------------------------------------------------------------

app.get("/completename", (req, res) => {

    if (!checkEspKey(req, res)) {
        return;
    }

    const id = Number(req.query.id);

    if (!Number.isInteger(id)) {
        return res.status(400).json({
            error: "invalid id"
        });
    }

    if (current === null) {
        return res.status(404).json({
            error: "no current item"
        });
    }

    if (current.id !== id) {
        return res.status(409).json({
            error: "id does not match current item",
            currentId: current.id
        });
    }

    console.log("Completed:", current);

    const completed = current;
    current = null;

    res.json({
        success: true,
        completed
    });
});

// -----------------------------------------------------------------------------
// Optional status endpoint
// -----------------------------------------------------------------------------

app.get("/status", (req, res) => {

    res.json({
        current,
        queued: queue,
        queueLength: queue.length + (current ? 1 : 0)
    });
});

// -----------------------------------------------------------------------------
// Reset
// -----------------------------------------------------------------------------

app.get("/reset", (req, res) => {

    if (req.query.key !== RESET_KEY) {
        return res.status(401).json({
            error: "invalid reset key"
        });
    }

    // Clear waiting names
    queue.length = 0;

    // Clear currently displayed item
    current = null;

    // Clear name rate records
    lastDisplayedName.clear();

    console.log("Everything has been reset.");

    res.json({
        success: true,
        message: "all names, current item, and IP rate limits have been cleared"
    });
});

// -----------------------------------------------------------------------------
// Start server
// -----------------------------------------------------------------------------

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});


