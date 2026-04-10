const mongoose = require("mongoose");

const connectDB = async () => {
    // ချိတ်ပြီးသားဆိုရင် ထပ်မချိတ်ဘဲ ပြန်လှည့်မယ်
    if (mongoose.connection.readyState >= 1) return;

    try {
        await mongoose.connect(process.env.MONGO_URI);
        // Local မှာ run နေစဉ်အတွင်းပဲ ဒီစာသားကို ပြချင်ရင် အောက်ကလို စစ်လို့ရပါတယ်
        if (process.env.NODE_ENV !== 'production') {
            console.log("✅ MongoDB Connected Successfully!");
        }
    } catch (err) {
        console.error("❌ MongoDB Connection Error:", err.message);
        // Database မချိတ်ဘဲ ရှေ့ဆက်ရင် error တက်မှာမို့လို့ process ကို ရပ်လိုက်မယ်
        if (process.env.NODE_ENV !== 'production') {
            process.exit(1);
        }
    }
};

// --- Schema Definitions ---

const matchSchema = new mongoose.Schema({
    fixtureId: { type: Number, unique: true },
    leagueId: Number,
    leagueName: String,
    home: String, 
    away: String,
    homeLogo: String, 
    awayLogo: String,
    utcDate: Date,
    status: String,
    score: { type: String, default: "0-0" },
    lastUpdated: { type: Date, default: Date.now }
});

const liveCacheSchema = new mongoose.Schema({
    fixtureId: { type: Number, unique: true },
    home: String,   // အသင်းနာမည် သိမ်းရန် ထပ်ဖြည့်ပါ
    away: String,   // အသင်းနာမည် သိမ်းရန် ထပ်ဖြည့်ပါ
    score: String,
    elapsed: Number,
    events: Array, 
    lastUpdated: { type: Date, default: Date.now }
});


const userSchema = new mongoose.Schema({
    userId: Number,
    username: String,
    subscriptions: [{ fixtureId: Number, home: String, away: String, isStartedNotified: Boolean }]
});

const apiLogSchema = new mongoose.Schema({
    date: { type: String, unique: true }, // ဥပမာ - "2024-04-10"
    count: { type: Number, default: 0 }
});

const ApiLog = mongoose.model("ApiLog", apiLogSchema);

// Models များကို Create လုပ်ခြင်း (သို့မဟုတ်) Existing model ကို ယူခြင်း
const Match = mongoose.models.Match || mongoose.model("Match", matchSchema);
const LiveCache = mongoose.models.LiveCache || mongoose.model("LiveCache", liveCacheSchema);
const User = mongoose.models.User || mongoose.model("User", userSchema);

module.exports = { connectDB, Match, LiveCache, User };
