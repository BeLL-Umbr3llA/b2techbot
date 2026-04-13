const mongoose = require("mongoose");
const mongoose = require('mongoose');

const connectDB = async () => {
    // ၁။ ချိတ်ပြီးသားဆိုရင် တန်းပြန်ထွက်မယ်
    if (mongoose.connection.readyState >= 1) {
        return mongoose.connection;
    }

    try {
        // ၂။ Connection options တွေကို ထည့်သွင်းမယ်
        const options = {
            bufferCommands: false, // Connection မရခင် query တွေကို queue ထဲမထည့်ဖို့
            serverSelectionTimeoutMS: 5000, // Database ရှာမတွေ့ရင် ၅ စက္ကန့်အတွင်း အဖြေပေးဖို့
        };

        const conn = await mongoose.connect(process.env.MONGO_URI, options);
        
        console.log("✅ MongoDB Connected!");
        return conn;
    } catch (err) {
        console.error("❌ MongoDB Connection Error:", err.message);
        // Serverless မှာ process.exit(1) မလုပ်ပါနဲ့၊ ဒါက instance တစ်ခုလုံး သေသွားစေနိုင်လို့ပါ
        throw err; 
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

const liveCacheSchema = new mongoose.Schema({ // Variable name ကို တစ်သမတ်တည်းဖြစ်အောင် အသေးပြောင်းထားတယ်
    type: { type: String, default: "match_data" }, 
    fixtureId: { type: Number },
    leagueId: { type: Number },
    home: String,
    away: String,
    score: String,
    elapsed: Number,
    status: String, // HT, FT, 1H, 2H စသည်တို့
    lastUpdated: { type: Date, default: Date.now }
}, { strict: false, timestamps: true });

const userSchema = new mongoose.Schema({
    userId: Number,
    name: String, // အရင် code မှာ u.name လို့ သုံးထားတာရှိလို့ name ထည့်ပေးထားတယ်
    username: String,
    subscriptions: [{ 
        fixtureId: Number, 
        home: String, 
        away: String, 
        startTime: Date, // ဒီပွဲစမယ့်အချိန်ကို Date object အနေနဲ့ သိမ်းမယ်
        isStartedNotified: { type: Boolean, default: false },
        chatId: { type: Number }, 
        topicId: { type: Number, default: 0 }
    }]
});

const apiLogSchema = new mongoose.Schema({
    date: { type: String, unique: true },
    api1_count: { type: Number, default: 0 },
    api2_count: { type: Number, default: 0 }
});

const StandingSchema = new mongoose.Schema({
    leagueId: { type: Number, unique: true },
    leagueName: String,
    season: Number,
    table: Array, // အသင်းအားလုံးရဲ့ ရမှတ်စာရင်း
    lastUpdated: { type: Date, default: Date.now }
});



// --- Models များကို Create လုပ်ခြင်း (သို့မဟုတ်) Existing model ကို ယူခြင်း ---
// OverwriteModelError ကို ကာကွယ်ရန် mongoose.models ကို အရင်စစ်ရပါမယ်

const Match = mongoose.models.Match || mongoose.model("Match", matchSchema);
const LiveCache = mongoose.models.LiveCache || mongoose.model("LiveCache", liveCacheSchema);
const User = mongoose.models.User || mongoose.model("User", userSchema);
const ApiLog = mongoose.models.ApiLog || mongoose.model("ApiLog", apiLogSchema);
const Standing = mongoose.models.Standing || mongoose.model("Standing", StandingSchema);
// Module Exports မှာ အကုန်လုံး ပါဝင်ကြောင်း သေချာစေရမယ်
module.exports = { connectDB, Match, LiveCache, User, ApiLog,Standing };
