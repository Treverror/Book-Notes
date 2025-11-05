import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import pg from "pg";
import dotenv from "dotenv"
import { fileURLToPath } from "url";
import path from "path";
import expressLayouts from "express-ejs-layouts";
import helmet from "helmet";
import crypto from "crypto";

dotenv.config();

const isProd = process.env.NODE_ENV === "production";


// Resolve __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// DB connection (defaults to database "library")
const db = new pg.Client({
    user: process.env.PGUSER || "postgres",
    host: process.env.PGHOST || "localhost",
    database: process.env.PGDATABASE || "library",
    password: process.env.PGPASSWORD || "password",
    port: Number(process.env.PGPORT) || 5432
});

await db.connect();

const app = express();
const port = process.env.PORT || 3000;

// View engine + layouts / This avoids repeating header/nav/footer across pages.
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));

app.use((req, res, next) => {
    const adminMode = req.query.admin === process.env.ADMIN_PASSWORD;
    res.locals.isAdmin = adminMode;
    next();
});


// Helpers
function coverFromISBN(isbn, size = "M", { defaultFalse = false } = {}) {
    const clean = String(isbn || "").replace(/[^0-9Xx]/g, "").toUpperCase();
    if (!(clean.length === 10 || clean.length === 13)) return null;
    const base = `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(clean)}-${size}.jpg`;
    return defaultFalse ? `${base}?default=false` : base;
}
// before routes:

app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
    next();
});

const scriptSrc = ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`];
// Optional: allow eval ONLY during local dev if something noisy requires it
if (!isProd) scriptSrc.push("'unsafe-eval'");

app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: false,
        directives: {
            "default-src": ["'self'"],
            "script-src": scriptSrc,
            "connect-src": ["'self'"],
            "style-src": ["'self'"],
            "img-src": ["'self'", "data:", "https:", "https://covers.openlibrary.org"],
            "font-src": ["'self'"],
            "object-src": ["'none'"],
            "frame-ancestors": ["'self'"],
            "base-uri": ["'self'"],
            "form-action": ["'self'"]
        }
    },
    referrerPolicy: { policy: "no-referrer" }
}));


// ROUTES
// Home: list books with sorting (creates orderBy variable to organize the SQL database response)
app.get("/", async (req, res, next) => {
    try {
        const sort = (req.query.sort || "recency").toLowerCase();
        let orderBy = "finished_on DESC NULLS LAST, created_at DESC";
        if (sort === "title") orderBy = "title ASC NULLS LAST";
        if (sort === "rating") orderBy = "rating DESC NULLS LAST, finished_on DESC NULLS LAST";

        const { rows: books } = await db.query(`
            SELECT id, title, author, isbn, cover_url, rating, finished_on, review, notes
            FROM books ORDER BY ${orderBy};
        `);

        res.render("index", {layout: "layout", books, sort, coverFromISBN });
    } catch (err) {
        next(err);
    }
});
// Form to add a new book
app.get("/books/new", (_req, res) => {
    res.render("new", { layout: "layout", sort: "recency" });
});

function normalizeIsbn(isbn) {
    return String(isbn || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

function makeCoverUrlFromIsbn(isbn, size = 'M') {
    const clean = normalizeIsbn(isbn);
    if (!(clean.length === 10 || clean.length === 13)) return null;
    return `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(clean)}-${size}.jpg`;
}

// CREATE
app.post("/books", async (req, res, next) => {
    try {
        const { title, author, isbn, rating, finished_on, review, notes } = req.body;

        // prefer existing good URL (from a search result using cover_i), else derive from isbn
        let cover_url = (req.body.cover_url && req.body.cover_url.startsWith('https://covers.openlibrary.org'))
            ? req.body.cover_url.trim()
            : makeCoverUrlFromIsbn(isbn, 'M');

        await db.query(
            `INSERT INTO books (title, author, isbn, cover_url, rating, finished_on, review, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [title, author || null, normalizeIsbn(isbn) || null, cover_url,
                rating ? Number(rating) : null, finished_on || null, review || null, notes || null]
        );
        res.redirect("/");
    } catch (err) { next(err); }
});


// Edit form
app.get("/books/:id/edit", async (req, res, next) => {
    try {
        const { id } = req.params;
        const { rows } = await db.query(`SELECT * FROM books WHERE id=$1`, [id]);
        if (!rows.length) return res.status(404).send("Not found");
        res.render("edit", { layout: "layout", sort: "recency", book: rows[0] });
    } catch (err) {
        next(err);
    }
});
// UPDATE
app.post("/books/:id", async (req, res, next) => {
    try {
        const { id } = req.params;
        const { title, author, isbn, rating, finished_on, review, notes } = req.body;

        let cover_url = (req.body.cover_url && req.body.cover_url.startsWith('https://covers.openlibrary.org'))
            ? req.body.cover_url.trim()
            : makeCoverUrlFromIsbn(isbn, 'M');

        await db.query(
            `UPDATE books SET
         title=$1, author=$2, isbn=$3, cover_url=$4, rating=$5,
         finished_on=$6, review=$7, notes=$8, updated_at=NOW()
       WHERE id=$9`,
            [title, author || null, normalizeIsbn(isbn) || null, cover_url,
                rating ? Number(rating) : null, finished_on || null, review || null, notes || null, id]
        );
        res.redirect("/");
    } catch (err) { next(err); }
});

// Delete
app.post("/books/:id/delete", async (req, res, next) => {
    try {
        const { id } = req.params;
        await db.query(`DELETE FROM books WHERE id=$1`, [id]);
        res.redirect("/");
    } catch (err) { next(err); }
});

// Ex API integration: search Open Library (GET endpoint using axios)
app.get("/api/search", async ( req, res, next) => {
    try {
        const q = req.query.q;
        if (!q) return res.status(400).json({ error: "Provide ?q=" });
        const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=5`;
        const { data } = await axios.get(url, { timeout: 10000 });
        const results = (data.docs || [])
            .slice(0, 5)
            .map((d) => {
                const isbn = (d.isbn && d.isbn[0]) || null;
                const coverId = d.cover_i || null;
                const cover_url = coverId
                    ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`
                    : (isbn ? coverFromISBN(isbn, "M") : null);
                return {
                    title: d.title,
                    author: (d.author_name && d.author_name[0]) || null,
                    isbn,
                    first_publish_year: d.first_publish_year || null,
                    cover_url,
                };
            });
        res.json({ query: q, results });
    } catch (err) {
        next(err);
    }
});

// Health check
app.get("/healthz", (_req, res) => res.json({ ok: true }));


// Error handler
app.use((err, _req, res, _next) => {
    console.log(err);
    res.status(500).send("Something broke. Check server logs.");
});
// Listening on
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});