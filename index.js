const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const url = require('url');
const querystring = require('querystring');
const bcrypt = require('bcrypt');
const cookie = require('cookie');
const crypto = require('crypto');

const PORT = 3000;

const dbConfig = {
    host: 'localhost',
    user: 'todo_user',
    password: '1234',
    database: 'todolist',
};

// Сессионное хранилище
const sessions = {};

// Middleware для проверки аутентификации
function checkAuth(req) {
    const cookies = cookie.parse(req.headers.cookie || '');
    const sessionId = cookies.sessionId;

    if (!sessionId || !sessions[sessionId]) {
        return null;
    }

    return sessions[sessionId].userId;
}

// Функции для работы с пользователями
async function createUser(username, password) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const connection = await mysql.createConnection(dbConfig);
    const query = 'INSERT INTO users (username, password_hash) VALUES (?, ?)';
    const [result] = await connection.execute(query, [username, hashedPassword]);
    await connection.end();
    return result.insertId;
}

async function verifyUser(username, password) {
    const connection = await mysql.createConnection(dbConfig);
    const query = 'SELECT id, password_hash FROM users WHERE username = ?';
    const [rows] = await connection.execute(query, [username]);
    await connection.end();

    if (rows.length === 0) {
        return null;
    }

    const user = rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);

    return isValid ? user.id : null;
}

// Функции для работы с задачами
async function retrieveListItems(userId) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'SELECT id, text FROM items WHERE user_id = ? ORDER BY id';
        const [rows] = await connection.execute(query, [userId]);
        await connection.end();
        return rows;
    } catch (error) {
        console.error('Error retrieving list items:', error);
        throw error;
    }
}

async function addItemToDB(text, userId) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'INSERT INTO items (text, user_id) VALUES (?, ?)';
        const [result] = await connection.execute(query, [text, userId]);
        await connection.end();
        return result.insertId;
    } catch (error) {
        console.error('Error adding item:', error);
        throw error;
    }
}

async function deleteItemFromDB(id, userId) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'DELETE FROM items WHERE id = ? AND user_id = ?';
        const [result] = await connection.execute(query, [id, userId]);
        await connection.end();
        return result.affectedRows > 0;
    } catch (error) {
        console.error('Error deleting item:', error);
        throw error;
    }
}

async function updateItemInDB(id, newText, userId) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'UPDATE items SET text = ? WHERE id = ? AND user_id = ?';
        const [result] = await connection.execute(query, [newText, id, userId]);
        await connection.end();
        return result.affectedRows > 0;
    } catch (error) {
        console.error('Error updating item:', error);
        throw error;
    }
}

async function getHtmlRows(userId) {
    const todoItems = await retrieveListItems(userId);
    return todoItems.map(item => `
    <tr data-id="${item.id}">
    <td>${item.id}</td>
    <td class="item-text">${item.text}</td>
    <td>
    <button class="edit-btn">Edit</button>
    <button class="delete-btn" data-id="${item.id}">×</button>
    </td>
    </tr>
    `).join('');
}

async function serveLoginPage(res, error = null) {
    try {
        let html = await fs.promises.readFile(path.join(__dirname, 'login.html'), 'utf8');
        if (error) {
            html = html.replace('<!-- ERROR_PLACEHOLDER -->',
                                '<div class="error">Invalid username or password</div>');
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(html);
    } catch (err) {
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Error loading login page');
    }
}

async function serveRegisterPage(res, error = null) {
    try {
        let html = await fs.promises.readFile(path.join(__dirname, 'register.html'), 'utf8');
        if (error) {
            html = html.replace('<!-- ERROR_PLACEHOLDER -->',
                                '<div class="error">Registration failed. Username may be taken.</div>');
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(html);
    } catch (err) {
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Error loading register page');
    }
}

async function handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);

    // Обработка статических файлов
    if (req.method === 'GET' && parsedUrl.pathname === '/styles.css') {
        try {
            const css = await fs.promises.readFile(path.join(__dirname, 'styles.css'), 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/css' });
            return res.end(css);
        } catch (err) {
            res.writeHead(404);
            return res.end();
        }
    }

    // Обработка маршрутов аутентификации
    if (req.method === 'GET' && parsedUrl.pathname === '/login') {
        return serveLoginPage(res, parsedUrl.query.error);
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/login') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            const { username, password } = querystring.parse(body);

            try {
                const userId = await verifyUser(username, password);
                if (userId) {
                    const sessionId = crypto.randomBytes(16).toString('hex');
                    sessions[sessionId] = { userId };

                    res.writeHead(302, {
                        'Location': '/',
                        'Set-Cookie': cookie.serialize('sessionId', sessionId, {
                            httpOnly: true,
                            maxAge: 60 * 60 * 24 * 7 // 1 week
                        })
                    });
                    return res.end();
                } else {
                    res.writeHead(302, { 'Location': '/login?error=1' });
                    return res.end();
                }
            } catch (error) {
                console.error(error);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                return res.end('Login error');
            }
        });
        return;
    }

    if (req.method === 'GET' && parsedUrl.pathname === '/register') {
        return serveRegisterPage(res, parsedUrl.query.error);
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/register') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            const { username, password } = querystring.parse(body);

            try {
                await createUser(username, password);
                res.writeHead(302, { 'Location': '/login' });
                return res.end();
            } catch (error) {
                console.error(error);
                res.writeHead(302, { 'Location': '/register?error=1' });
                return res.end();
            }
        });
        return;
    }

    if (req.method === 'GET' && parsedUrl.pathname === '/logout') {
        const cookies = cookie.parse(req.headers.cookie || '');
        const sessionId = cookies.sessionId;

        if (sessionId && sessions[sessionId]) {
            delete sessions[sessionId];
        }

        res.writeHead(302, {
            'Location': '/login',
            'Set-Cookie': cookie.serialize('sessionId', '', {
                httpOnly: true,
                expires: new Date(0)
            })
        });
        return res.end();
    }

    // Проверка аутентификации для защищенных маршрутов
    const userId = await checkAuth(req);

    if (!userId && parsedUrl.pathname !== '/login' && parsedUrl.pathname !== '/register') {
        res.writeHead(302, { 'Location': '/login' });
        return res.end();
    }

    // Новый endpoint для проверки привязки Telegram
    if (req.method === 'GET' && parsedUrl.pathname === '/check-telegram') {
        try {
            const connection = await mysql.createConnection(dbConfig);
            const query = 'SELECT telegram_id FROM users WHERE id = ?';
            const [rows] = await connection.execute(query, [userId]);
            await connection.end();

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ hasTelegram: !!rows[0]?.telegram_id }));
        } catch (error) {
            console.error(error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Database error' }));
        }
    }

    // Обработка защищенных маршрутов
    if (req.method === 'GET' && parsedUrl.pathname === '/') {
        try {
            const html = await fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8');
            const processedHtml = html.replace('{{rows}}', await getHtmlRows(userId));

            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(processedHtml);
        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            return res.end('Error loading index.html');
        }
    }
    else if (req.method === 'POST' && parsedUrl.pathname === '/add') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            const text = new URLSearchParams(body).get('text');
            if (text && text.trim()) {
                try {
                    await addItemToDB(text.trim(), userId);
                    res.writeHead(302, { 'Location': '/' });
                    return res.end();
                } catch (error) {
                    console.error(error);
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    return res.end('Error adding item');
                }
            } else {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                return res.end('Invalid input');
            }
        });
        return;
    }
    else if (req.method === 'POST' && parsedUrl.pathname === '/delete') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            const { id } = querystring.parse(body);
            if (id) {
                try {
                    const success = await deleteItemFromDB(id, userId);
                    if (success) {
                        res.writeHead(302, { 'Location': '/' });
                        return res.end();
                    } else {
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        return res.end('Item not found');
                    }
                } catch (error) {
                    console.error(error);
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    return res.end('Error deleting item');
                }
            } else {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                return res.end('Invalid ID');
            }
        });
        return;
    }
    else if (req.method === 'POST' && parsedUrl.pathname === '/update') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            const { id, text } = querystring.parse(body);
            if (id && text && text.trim()) {
                try {
                    const success = await updateItemInDB(id, text.trim(), userId);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success }));
                } catch (error) {
                    console.error(error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, error: 'Error updating item' }));
                }
            } else {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, error: 'Invalid input' }));
            }
        });
        return;
    }
    else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not Found');
    }
}

const server = http.createServer(handleRequest);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
