const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

// Конфигурация базы данных
const dbConfig = {
    host: 'localhost',
    user: 'todo_user',
    password: '1234',
    database: 'todolist',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// Создаем пул соединений вместо отдельных подключений
const pool = mysql.createPool(dbConfig);

// Токен вашего Telegram бота
const TOKEN = '7322575537:AAGTNUN2gy4Wan2O1TCDbIIPF87FzeXRkgo';
const bot = new TelegramBot(TOKEN, {
    polling: true,
    request: {
        timeout: 10000
    }
});

// Функция для получения пользователя по Telegram ID
async function getUserByTelegramId(telegramId) {
    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.query(
            'SELECT id, username FROM users WHERE telegram_id = ?',
            [telegramId]
        );
        return rows[0] || null;
    } catch (error) {
        console.error('Database error in getUserByTelegramId:', error);
        throw error;
    } finally {
        if (connection) connection.release();
    }
}

// Основной обработчик команд
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const text = msg.text;

    // Игнорируем сообщения без текста или не начинающиеся с /
    if (!text || !text.startsWith('/')) {
        return;
    }

    try {
        // Разбиваем команду на части
        const parts = text.split(' ').filter(p => p.trim());
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);

        // Обработка разных команд
        switch (command) {
            case '/start':
                await handleStart(chatId);
                break;

            case '/link':
                if (args.length < 2) {
                    await bot.sendMessage(chatId, '❌ Неправильный формат. Используйте: /link <логин> <пароль>');
                    return;
                }
                await handleLink(chatId, telegramId, args[0], args[1]);
                break;

            case '/list':
                await handleList(chatId, telegramId);
                break;

            case '/add':
                if (args.length < 1) {
                    await bot.sendMessage(chatId, '❌ Неправильный формат. Используйте: /add <текст задачи>');
                    return;
                }
                await handleAdd(chatId, telegramId, args.join(' '));
                break;

            case '/delete':
                if (args.length < 1 || isNaN(args[0])) {
                    await bot.sendMessage(chatId, '❌ Неправильный формат. Используйте: /delete <ID задачи>');
                    return;
                }
                await handleDelete(chatId, telegramId, parseInt(args[0]));
                break;

            case '/edit':
                if (args.length < 2 || isNaN(args[0])) {
                    await bot.sendMessage(chatId, '❌ Неправильный формат. Используйте: /edit <ID> <новый текст>');
                    return;
                }
                await handleEdit(chatId, telegramId, parseInt(args[0]), args.slice(1).join(' '));
                break;

            default:
                await bot.sendMessage(chatId, '❌ Неизвестная команда. Доступные команды:\n\n' +
                '/start - Начало работы\n' +
                '/link - Привязать аккаунт\n' +
                '/list - Показать задачи\n' +
                '/add - Добавить задачу\n' +
                '/delete - Удалить задачу\n' +
                '/edit - Изменить задачу');
        }
    } catch (error) {
        console.error('Error handling message:', error);
        await bot.sendMessage(chatId, '⚠️ Произошла ошибка при обработке команды. Пожалуйста, попробуйте позже.');
    }
});

// Обработчики конкретных команд
async function handleStart(chatId) {
    await bot.sendMessage(
        chatId,
        `📝 To-Do List Bot\n\n` +
        `Этот бот помогает управлять вашими задачами.\n\n` +
        `Сначала привяжите свой аккаунт:\n` +
        `/link <логин> <пароль>\n\n` +
        `После привязки доступны команды:\n` +
        `/list - Показать задачи\n` +
        `/add <текст> - Добавить задачу\n` +
        `/delete <ID> - Удалить задачу\n` +
        `/edit <ID> <текст> - Изменить задачу`
    );
}

async function handleLink(chatId, telegramId, username, password) {
    let connection;
    try {
        connection = await pool.getConnection();

        // Проверяем пользователя
        const [users] = await connection.query(
            'SELECT id, password_hash FROM users WHERE username = ?',
            [username]
        );

        if (users.length === 0) {
            await bot.sendMessage(chatId, '❌ Пользователь не найден. Проверьте логин.');
            return;
        }

        const user = users[0];
        const isValid = await bcrypt.compare(password, user.password_hash);

        if (!isValid) {
            await bot.sendMessage(chatId, '❌ Неверный пароль. Попробуйте снова.');
            return;
        }

        // Привязываем Telegram ID
        await connection.query(
            'UPDATE users SET telegram_id = ? WHERE id = ?',
            [telegramId, user.id]
        );

        await bot.sendMessage(
            chatId,
            '✅ Аккаунт успешно привязан!\n\n' +
            'Теперь вы можете управлять задачами:\n' +
            '/list - Показать все задачи\n' +
            '/add [текст] - Добавить задачу\n' +
            '/delete [ID] - Удалить задачу\n' +
            '/edit [ID] [текст] - Изменить задачу'
        );
    } catch (error) {
        console.error('Error in link command:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            await bot.sendMessage(chatId, '❌ Этот Telegram аккаунт уже привязан.');
        } else {
            throw error;
        }
    } finally {
        if (connection) connection.release();
    }
}

async function handleList(chatId, telegramId) {
    const user = await getUserByTelegramId(telegramId);
    if (!user) {
        await bot.sendMessage(chatId, '❌ Сначала привяжите аккаунт командой /link');
        return;
    }

    let connection;
    try {
        connection = await pool.getConnection();
        const [tasks] = await connection.query(
            'SELECT id, text FROM items WHERE user_id = ? ORDER BY created_at DESC',
            [user.id]
        );

        if (tasks.length === 0) {
            await bot.sendMessage(chatId, '📝 Список задач пуст. Добавьте первую задачу командой /add');
            return;
        }

        const tasksList = tasks.map(task => `#${task.id}: ${task.text}`).join('\n\n');
        await bot.sendMessage(
            chatId,
            `📋 Ваши задачи (${tasks.length}):\n\n${tasksList}`
        );
    } catch (error) {
        console.error('Error in list command:', error);
        throw error;
    } finally {
        if (connection) connection.release();
    }
}

async function handleAdd(chatId, telegramId, text) {
    const user = await getUserByTelegramId(telegramId);
    if (!user) {
        await bot.sendMessage(chatId, '❌ Сначала привяжите аккаунт командой /link');
        return;
    }

    if (!text || text.trim().length === 0) {
        await bot.sendMessage(chatId, '❌ Текст задачи не может быть пустым');
        return;
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.query(
            'INSERT INTO items (text, user_id) VALUES (?, ?)',
                               [text.trim(), user.id]
        );

        await bot.sendMessage(
            chatId,
            `✅ Задача добавлена:\n"${text.trim()}"`
        );
    } catch (error) {
        console.error('Error in add command:', error);
        throw error;
    } finally {
        if (connection) connection.release();
    }
}

async function handleDelete(chatId, telegramId, taskId) {
    const user = await getUserByTelegramId(telegramId);
    if (!user) {
        await bot.sendMessage(chatId, '❌ Сначала привяжите аккаунт командой /link');
        return;
    }

    let connection;
    try {
        connection = await pool.getConnection();
        const [result] = await connection.query(
            'DELETE FROM items WHERE id = ? AND user_id = ?',
            [taskId, user.id]
        );

        if (result.affectedRows > 0) {
            await bot.sendMessage(chatId, `✅ Задача #${taskId} удалена`);
        } else {
            await bot.sendMessage(chatId, `❌ Задача #${taskId} не найдена`);
        }
    } catch (error) {
        console.error('Error in delete command:', error);
        throw error;
    } finally {
        if (connection) connection.release();
    }
}

async function handleEdit(chatId, telegramId, taskId, newText) {
    const user = await getUserByTelegramId(telegramId);
    if (!user) {
        await bot.sendMessage(chatId, '❌ Сначала привяжите аккаунт командой /link');
        return;
    }

    if (!newText || newText.trim().length === 0) {
        await bot.sendMessage(chatId, '❌ Текст задачи не может быть пустым');
        return;
    }

    let connection;
    try {
        connection = await pool.getConnection();
        const [result] = await connection.query(
            'UPDATE items SET text = ? WHERE id = ? AND user_id = ?',
            [newText.trim(), taskId, user.id]
        );

        if (result.affectedRows > 0) {
            await bot.sendMessage(chatId, `✅ Задача #${taskId} обновлена:\n"${newText.trim()}"`);
        } else {
            await bot.sendMessage(chatId, `❌ Задача #${taskId} не найдена`);
        }
    } catch (error) {
        console.error('Error in edit command:', error);
        throw error;
    } finally {
        if (connection) connection.release();
    }
}

// Обработка ошибок бота
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
});

console.log('🤖 Бот запущен и ожидает команд...');
