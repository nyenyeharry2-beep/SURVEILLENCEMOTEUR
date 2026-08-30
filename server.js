// ============================================================
// SERVEUR IoT - SURVEILLANCE MOTEUR
// ESP32 -> Render -> PostgreSQL -> Interface Web
// ============================================================

const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 10000;

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// FICHIERS WEB
// ============================================================

app.use(express.static(__dirname));

// ============================================================
// POSTGRESQL
// ============================================================

let pool = null;

if (process.env.DATABASE_URL) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });

    console.log("DATABASE_URL détectée.");
} else {
    console.log("DATABASE_URL non configurée.");
}

// ============================================================
// DERNIERE DONNEE
// ============================================================

let derniereDonnee = {
    rpm: 0,
    ax: 0,
    ay: 0,
    az: 0,
    arms: 0,
    vrms: 0,
    impulsions: 0,
    ecart: 0,
    heure: "00:00:00",
    etat: "ARRET",
    moteur: "OFF",
    alarme: "OFF",
    probleme: "AUCUN"
};

// ============================================================
// COMMANDES
// ============================================================

let derniereCommande = "NONE";
let numeroCommande = 0;

// ============================================================
// INITIALISATION BASE
// ============================================================

async function initialiserBase() {

    if (!pool) {
        return;
    }

    try {

        await pool.query(`
            CREATE TABLE IF NOT EXISTS mesures (
                id SERIAL PRIMARY KEY,
                created_at TIMESTAMPTZ DEFAULT NOW(),

                rpm DOUBLE PRECISION DEFAULT 0,
                ax DOUBLE PRECISION DEFAULT 0,
                ay DOUBLE PRECISION DEFAULT 0,
                az DOUBLE PRECISION DEFAULT 0,

                arms DOUBLE PRECISION DEFAULT 0,
                vrms DOUBLE PRECISION DEFAULT 0,

                impulsions INTEGER DEFAULT 0,
                ecart DOUBLE PRECISION DEFAULT 0,

                heure TEXT,

                etat TEXT,
                moteur TEXT,

                alarme TEXT,
                probleme TEXT
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS commandes (
                id SERIAL PRIMARY KEY,
                commande TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                executee BOOLEAN DEFAULT FALSE
            )
        `);

        console.log("Base PostgreSQL initialisée.");

    } catch (error) {

        console.error(
            "Erreur PostgreSQL :",
            error.message
        );
    }
}

// ============================================================
// PAGE PRINCIPALE
// ============================================================

app.get("/", (req, res) => {

    res.sendFile(
        path.join(__dirname, "index.html")
    );

});

// ============================================================
// TEST SERVEUR
// ============================================================

app.get("/api/status", (req, res) => {

    res.json({

        success: true,

        serveur: "surveillance-moteur",

        database: !!pool,

        timestamp: new Date().toISOString()

    });

});

// ============================================================
// GET /api/data
// ============================================================

app.get("/api/data", async (req, res) => {

    try {

        if (pool) {

            const result = await pool.query(`
                SELECT
                    rpm,
                    ax,
                    ay,
                    az,
                    arms,
                    vrms,
                    impulsions,
                    ecart,
                    heure,
                    etat,
                    moteur,
                    alarme,
                    probleme
                FROM mesures
                ORDER BY id DESC
                LIMIT 1
            `);

            if (result.rows.length > 0) {

                const d = result.rows[0];

                derniereDonnee = {

                    rpm: Number(d.rpm || 0),
                    ax: Number(d.ax || 0),
                    ay: Number(d.ay || 0),
                    az: Number(d.az || 0),

                    arms: Number(d.arms || 0),
                    vrms: Number(d.vrms || 0),

                    impulsions:
                        Number(d.impulsions || 0),

                    ecart:
                        Number(d.ecart || 0),

                    heure:
                        d.heure || "00:00:00",

                    etat:
                        d.etat || "ARRET",

                    moteur:
                        d.moteur || "OFF",

                    alarme:
                        d.alarme || "OFF",

                    probleme:
                        d.probleme || "AUCUN"
                };
            }
        }

        res.json({
            success: true,
            ...derniereDonnee
        });

    } catch (error) {

        console.error(
            "GET /api/data :",
            error.message
        );

        res.json({
            success: true,
            ...derniereDonnee
        });
    }
});

// ============================================================
// POST /api/data
// ESP32 -> SERVEUR
// ============================================================

app.post("/api/data", async (req, res) => {

    try {

        const body = req.body || {};

        const rpm = Number(body.rpm ?? 0);

        const ax = Number(body.ax ?? 0);
        const ay = Number(body.ay ?? 0);
        const az = Number(body.az ?? 0);

        const arms = Number(
            body.arms ??
            body.accelerationRMS ??
            0
        );

        const vrms = Number(
            body.vrms ??
            body.vibration ??
            0
        );

        const impulsions = Number(
            body.impulsions ?? 0
        );

        const ecart = Number(
            body.ecart ?? 0
        );

        const heure = String(
            body.heure ||
            new Date().toLocaleTimeString(
                "fr-FR",
                {
                    hour12: false
                }
            )
        );

        const etat = String(
            body.etat || "ARRET"
        );

        const moteur = String(
            body.moteur || "OFF"
        );

        const alarme = String(
            body.alarme || "OFF"
        );

        const probleme = String(
            body.probleme || "AUCUN"
        );

        // ====================================================
        // MISE A JOUR MEMOIRE
        // ====================================================

        derniereDonnee = {

            rpm,

            ax,
            ay,
            az,

            arms,
            vrms,

            impulsions,

            ecart,

            heure,

            etat,
            moteur,

            alarme,
            probleme
        };

        console.log(
            "DONNEES ESP32 :",
            JSON.stringify(derniereDonnee)
        );

        // ====================================================
        // POSTGRESQL
        // ====================================================

        if (pool) {

            await pool.query(`
                INSERT INTO mesures (
                    rpm,
                    ax,
                    ay,
                    az,
                    arms,
                    vrms,
                    impulsions,
                    ecart,
                    heure,
                    etat,
                    moteur,
                    alarme,
                    probleme
                )
                VALUES (
                    $1, $2, $3, $4,
                    $5, $6,
                    $7, $8,
                    $9,
                    $10, $11,
                    $12, $13
                )
            `, [

                rpm,
                ax,
                ay,
                az,

                arms,
                vrms,

                impulsions,
                ecart,

                heure,

                etat,
                moteur,

                alarme,
                probleme

            ]);
        }

        res.json({

            success: true,

            message: "Mesure reçue",

            data: derniereDonnee

        });

    } catch (error) {

        console.error(
            "POST /api/data :",
            error
        );

        res.status(500).json({

            success: false,

            error: "Erreur traitement données",

            details: error.message

        });
    }
});

// ============================================================
// GET /api/history
// ============================================================

app.get("/api/history", async (req, res) => {

    try {

        if (!pool) {

            return res.json({

                success: true,

                count: 0,

                data: []

            });
        }

        let limite = Number(
            req.query.limit || 100
        );

        if (!Number.isFinite(limite)) {
            limite = 100;
        }

        limite = Math.max(
            1,
            Math.min(limite, 1000)
        );

        const result = await pool.query(`
            SELECT
                id,
                created_at,
                rpm,
                ax,
                ay,
                az,
                arms,
                vrms,
                impulsions,
                ecart,
                heure,
                etat,
                moteur,
                alarme,
                probleme
            FROM mesures
            ORDER BY id DESC
            LIMIT $1
        `, [limite]);

        res.json({

            success: true,

            count:
                result.rows.length,

            data:
                result.rows

        });

    } catch (error) {

        console.error(
            "GET /api/history :",
            error.message
        );

        res.status(500).json({

            success: false,

            error:
                "Erreur récupération historique",

            details:
                error.message

        });
    }
});

// ============================================================
// POST /api/command
// PAGE WEB -> SERVEUR
// ============================================================

app.post("/api/command", async (req, res) => {

    try {

        let commande =
            req.body?.command ||
            req.body?.commande;

        if (!commande) {

            return res.status(400).json({

                success: false,

                error:
                    "Commande absente"

            });
        }

        commande = String(
            commande
        )
        .trim()
        .toUpperCase();

        if (
            commande !== "START" &&
            commande !== "STOP"
        ) {

            return res.status(400).json({

                success: false,

                error:
                    "Commande invalide"

            });
        }

        numeroCommande++;

        derniereCommande =
            commande;

        if (pool) {

            await pool.query(`
                INSERT INTO commandes (
                    commande,
                    executee
                )
                VALUES ($1, FALSE)
            `, [
                commande
            ]);
        }

        console.log(
            "COMMANDE :",
            commande
        );

        res.json({

            success: true,

            commande,

            numeroCommande

        });

    } catch (error) {

        console.error(
            "POST /api/command :",
            error.message
        );

        res.status(500).json({

            success: false,

            error:
                "Erreur commande",

            details:
                error.message

        });
    }
});

// ============================================================
// GET /api/command
// ESP32 -> SERVEUR
// ============================================================

app.get("/api/command", async (req, res) => {

    try {

        if (pool) {

            const result =
                await pool.query(`
                    SELECT
                        id,
                        commande,
                        created_at
                    FROM commandes
                    WHERE executee = FALSE
                    ORDER BY id ASC
                    LIMIT 1
                `);

            if (result.rows.length > 0) {

                const commande =
                    result.rows[0];

                await pool.query(`
                    UPDATE commandes
                    SET executee = TRUE
                    WHERE id = $1
                `, [
                    commande.id
                ]);

                derniereCommande =
                    commande.commande;

                res.json({

                    success: true,

                    commande:
                        commande.commande,

                    numeroCommande:
                        commande.id

                });

                return;
            }
        }

        res.json({

            success: true,

            commande: "NONE",

            numeroCommande: 0

        });

    } catch (error) {

        console.error(
            "GET /api/command :",
            error.message
        );

        res.status(500).json({

            success: false,

            error:
                "Erreur récupération commande",

            details:
                error.message

        });
    }
});

// ============================================================
// 404
// ============================================================

app.use((req, res) => {

    res.status(404).json({

        success: false,

        error: "Route introuvable",

        route: req.originalUrl

    });

});

// ============================================================
// DEMARRAGE
// ============================================================

async function demarrer() {

    await initialiserBase();

    app.listen(
        PORT,
        "0.0.0.0",
        () => {

            console.log(
                "======================================"
            );

            console.log(
                " SERVEUR SURVEILLANCE MOTEUR"
            );

            console.log(
                "======================================"
            );

            console.log(
                "PORT :",
                PORT
            );

            console.log(
                "WEB : /"
            );

            console.log(
                "DATA : GET/POST /api/data"
            );

            console.log(
                "HISTORY : GET /api/history"
            );

            console.log(
                "COMMAND : GET/POST /api/command"
            );

            console.log(
                "DATABASE :",
                pool
                    ? "CONNECTEE"
                    : "NON CONFIGUREE"
            );

            console.log(
                "======================================"
            );
        }
    );
}

demarrer();
