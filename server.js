const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const path = require('path');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const CLIENT_ID = process.env.CLIENT_ID || '';
const CLIENT_SECRET = process.env.CLIENT_SECRET || '';
const CALLBACK_URL = process.env.CALLBACK_URL || 'https://luacn-server-point-bot-deshboard.onrender.com/auth/discord/callback';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';

// 세션 설정
app.use(session({
    secret: 'luacn-super-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, 
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

app.use(express.json());
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => { done(null, user); });
passport.deserializeUser((obj, done) => { done(null, obj); });

// 디스코드 OAuth2 전략 설정
passport.use(new DiscordStrategy({
    clientID: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    callbackURL: CALLBACK_URL,
    scope: ['identify']
}, (accessToken, refreshToken, profile, done) => {
    try { return done(null, profile); } 
    catch (err) { return done(err, null); }
}));

// 로그인 라우트
app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback', 
    passport.authenticate('discord', { failureRedirect: '/', failureMessage: true }), 
    (req, res) => { res.redirect('/dashboard'); }
);

app.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/');
    });
});

function checkAuth(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
    }
    res.redirect('/');
}

// 메인 페이지 (로그인 버튼)
app.get('/', (req, res) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
        return res.redirect('/dashboard');
    }
    res.send(`
        <div style="text-align:center; margin-top: 100px; font-family: sans-serif; background-color: #1e1f22; color: white; height: 100vh; padding-top: 50px;">
            <h1>🤖 루칸 포인트 대시보드</h1>
            <p>서비스를 이용하시려면 디스코드 로그인이 필요합니다.</p>
            <br>
            <a href="/auth/discord" style="background:#5865F2; color:white; padding:12px 24px; text-decoration:none; border-radius:5px; font-weight:bold;">Discord로 로그인</a>
        </div>
    `);
});

// 대시보드 HTML 파일 제공
app.get('/dashboard', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// 현재 로그인한 유저 정보 API
app.get('/api/user', checkAuth, (req, res) => {
    try {
        const user = req.user;
        const avatarUrl = user.avatar 
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/0.png`;

        res.json({
            id: user.id,
            username: user.username,
            avatar: avatarUrl
        });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 타 유저 프로필 조회 API
app.get('/api/discord-user/:id', checkAuth, async (req, res) => {
    const targetId = req.params.id;
    try {
        const response = await axios.get(`https://discord.com/api/v10/users/${targetId}`, {
            headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
        });
        const userData = response.data;
        const avatarUrl = userData.avatar 
            ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/${(userData.discriminator || 0) % 5}.png`;

        res.json({
            success: true,
            id: userData.id,
            username: userData.global_name || userData.username,
            tag: userData.username,
            avatar: avatarUrl
        });
    } catch (error) {
        res.json({ success: false, message: '존재하지 않거나 조회할 수 없는 유저 ID입니다.' });
    }
});

// 상점 구매 API (웹 -> 봇 소켓 통신)
app.post('/api/shop/buy', checkAuth, (req, res) => {
    const { itemType } = req.body;
    const userId = req.user.id;

    if (!botSocket) {
        return res.json({ success: false, message: '디스코드 봇이 오프라인 상태입니다. 잠시 후 시도해주세요.' });
    }

    botSocket.emit('process_shop_purchase', { userId, itemType }, (response) => {
        res.json(response);
    });
});

let botSocket = null;
let latestRankings = [];

io.on('connection', (socket) => {
    socket.on('bot_register', () => {
        botSocket = socket;
        console.log('🤖 디스코드 봇 소켓 연결됨');
    });

    socket.on('request_user_point', (data) => {
        if (botSocket) botSocket.emit('get_user_point', data);
    });

    socket.on('send_user_point', (data) => {
        io.emit('update_user_point', data);
    });

    socket.on('submit_transfer', (data) => {
        if (botSocket) botSocket.emit('process_transfer', data);
    });

    socket.on('transfer_result', (data) => {
        io.emit('transfer_response', data);
    });

    socket.on('request_user_mission', (data) => {
        if (botSocket) botSocket.emit('get_user_mission', data);
    });

    socket.on('send_user_mission', (data) => {
        io.emit('update_user_mission', data);
    });

    // 랭킹 데이터 수신 및 브로드캐스트
    socket.on('send_ranking_data', (data) => {
        latestRankings = data;
        io.emit('update_ranking_data', data);
    });

    socket.on('request_ranking', () => {
        if (botSocket) botSocket.emit('request_ranking_data');
        else socket.emit('update_ranking_data', latestRankings);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`웹서버 포트: ${PORT}`));
