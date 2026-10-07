import express from 'express'
const app = express();
app.use(express.json());

app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

app.listen(8000, () => {
    console.log("Server listening on port 8000");
});