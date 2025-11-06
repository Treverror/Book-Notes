-npm init

-npm i

-create .env file for:

isAdmin

const db = new pg.Client({
    user: process.env.PGUSER || "postgres",
    host: process.env.PGHOST || "localhost",
    database: process.env.PGDATABASE || "library",
    password: process.env.PGPASSWORD || "password",
    port: Number(process.env.PGPORT) || 5432
});

-run nodemon index.js
