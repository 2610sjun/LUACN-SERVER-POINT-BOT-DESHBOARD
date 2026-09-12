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

// 세션 설정 (Render 환경에 맞게 안전하게 설정)
app.use(session({
    secret: 'luacn-super-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Render는 기본 HTTP 프록시를 쓰므로 false가 안전합니다
        maxAge: 24 * 60 * 60 * 1000 // 24시간
    }
}));

app.use(express.json());
app.use(passport.initialize());
app.use(passport.session());

// Passport 직렬화 설정 (에러 방어용)
passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

// 디스코드 OAuth2 전략 설정
passport.use(new DiscordStrategy({
    clientID: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    callbackURL: CALLBACK_URL,
    scope: ['identify']
}, (accessToken, refreshToken, profile, done) => {
    try {
        return done(null, profile);
    } catch (err) {
        return done(err, null);
    }
}));

// 로그인 라우트
app.get('/auth/discord', passport.authenticate('discord'));

// 콜백 라우트 (여기서 500 에러가 나던 지점입니다)
app.get('/auth/discord/callback', 
    passport.authenticate('discord', { 
        failureRedirect: '/',
        failureMessage: true 
    }), 
    (req, res) => {
        // 로그인 성공 시 대시보드로 이동
        res.redirect('/dashboard');
    }
);

app.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/');
    });
});

// 인증 미들웨어
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
        console.error('API /api/user 에러:', err);
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
        console.error('디스코드 유저 조회 에러:', error.response ? error.response.data : error.message);
        res.json({ success: false, message: '존재하지 않거나 조회할 수 없는 유저 ID입니다.' });
    }
});

let botSocket = null;

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

    socket.on('request_auctions', () => {
        if (botSocket) botSocket.emit('get_auctions');
    });

    socket.on('send_auctions', (data) => {
        io.emit('update_auctions', data);
    });

    socket.on('submit_bid', (data) => {
        if (botSocket) botSocket.emit('process_bid', data);
    });

    socket.on('bid_result', (data) => {
        io.emit('bid_response', data);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`웹서버 포트: ${PORT}`));
