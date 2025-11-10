import { NextApiRequest } from 'next';
import { NextApiResponseServerIO } from '@/lib/socket';
import { Server as SocketIOServer } from 'socket.io';
import { addFilmToGroup, getFilmsByGroup, getGroupByCode, getVotesByGroup, deleteFilmsByGroup, deleteVotesByGroup, Film } from '@/lib/database';
import { Vote } from '@/lib/groups';
import { addParticipantToGroup, removeParticipantFromGroup, getGroupParticipants, addSocketToGroup, removeSocketFromGroup } from '@/lib/socket';

// Интерфейс для результатов голосования
interface VotingResults {
  superMatch: { film: Film; voters: string[] } | null;
  bestMatch: { film: Film; likes: number; voters: string[] } | null;
  totalParticipants: number;
  votedParticipants: number;
}

// Функция для вычисления результатов голосования
function calculateResults(votes: Vote[], films: Film[], participants: string[]): VotingResults {
  // Группируем голоса по фильмам
  const votesByFilm = new Map<number, { likes: number; dislikes: number; voters: string[] }>();
  
  votes.forEach(vote => {
    if (!votesByFilm.has(vote.filmId)) {
      votesByFilm.set(vote.filmId, { likes: 0, dislikes: 0, voters: [] });
    }
    const filmVotes = votesByFilm.get(vote.filmId)!;
    if (vote.vote === 'like') {
      filmVotes.likes++;
    } else {
      filmVotes.dislikes++;
    }
    if (!filmVotes.voters.includes(vote.participantId)) {
      filmVotes.voters.push(vote.participantId);
    }
  });

  let superMatch: { film: Film; voters: string[] } | null = null;
  let bestMatch: { film: Film; likes: number; voters: string[] } | null = null;

  films.forEach(film => {
    const filmVotes = votesByFilm.get(film.kinopoiskId);
    if (!filmVotes) return;

    // Проверяем SUPER MATCH: все участники лайкнули
    if (filmVotes.likes === participants.length && filmVotes.dislikes === 0) {
      superMatch = { film, voters: filmVotes.voters };
    }

    // Ищем фильм с наибольшим количеством лайков
    if (!bestMatch || filmVotes.likes > bestMatch.likes) {
      bestMatch = { film, likes: filmVotes.likes, voters: filmVotes.voters };
    }
  });

  return {
    superMatch,
    bestMatch,
    totalParticipants: participants.length,
    votedParticipants: votes.length > 0 ? new Set(votes.map(v => v.participantId)).size : 0
  };
}

export default function SocketHandler(req: NextApiRequest, res: NextApiResponseServerIO) {
  if (res.socket.server.io) {
    console.log('Socket is already running');
    res.end();
    return;
  }

  console.log('Socket is initializing');
  const io = new SocketIOServer(res.socket.server, {
    path: '/api/socket',
    addTrailingSlash: false,
    cors: {
      origin: process.env.NODE_ENV === 'production' 
        ? (process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*')
        : '*', // В разработке разрешаем все, в продакшене используем ALLOWED_ORIGINS или все
      methods: ['GET', 'POST'],
      credentials: true,
      allowedHeaders: ['Content-Type'],
    },
    transports: ['websocket', 'polling'],
  });

  res.socket.server.io = io;

  io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Подключение к группе
    socket.on('group:join', async (data) => {
      try {
        const { groupCode, participantName } = data;
        
        // Валидация входных данных
        if (!groupCode || typeof groupCode !== 'string') {
          socket.emit('notification:error', { message: 'Неверный код группы' });
          return;
        }
        
        if (!participantName || typeof participantName !== 'string') {
          socket.emit('notification:error', { message: 'Неверное имя участника' });
          return;
        }

        // Санитизация
        const sanitizedCode = groupCode.trim().toUpperCase().slice(0, 10);
        const sanitizedParticipantName = participantName.trim().slice(0, 50);

        if (sanitizedCode.length === 0 || sanitizedParticipantName.length === 0) {
          socket.emit('notification:error', { message: 'Код группы и имя участника не могут быть пустыми' });
          return;
        }

        // Валидация формата кода группы
        if (!/^[A-Z0-9]{5}$/.test(sanitizedCode)) {
          socket.emit('notification:error', { message: 'Неверный формат кода группы' });
          return;
        }
        
        // ВАЖНО: Получаем свежие данные из БД при каждом присоединении
        // Это гарантирует, что мы не используем устаревшие данные с "мертвыми душами"
        const group = await getGroupByCode(sanitizedCode);
        if (!group) {
          socket.emit('notification:error', { message: 'Группа не найдена' });
          return;
        }
        
        // БД - единственный источник истины для списка участников
        const dbParticipants = group.participants || [];
        
        // Проверяем, есть ли участник в БД
        const isInDatabase = dbParticipants.includes(sanitizedParticipantName);
        
        // Если участника нет в БД, добавляем его
        if (!isInDatabase) {
          try {
            const { updateGroup } = await import('@/lib/database');
            const updatedParticipants = [...dbParticipants, sanitizedParticipantName];
            await updateGroup(group.id, { participants: updatedParticipants });
            dbParticipants.push(sanitizedParticipantName);
          } catch (err) {
            console.error('Error adding participant to database:', err);
          }
        }
        
        // Сохраняем данные в socket
        socket.data.groupCode = sanitizedCode;
        socket.data.participantName = sanitizedParticipantName;
        
        // Отслеживаем активное соединение (только для управления комнатами)
        addSocketToGroup(sanitizedCode, socket.id);
        socket.join(sanitizedCode);
        
        // Проверяем, было ли уже активное WebSocket соединение для этого участника
        const currentWebSocketParticipants = getGroupParticipants(sanitizedCode);
        const wasAlreadyConnected = currentWebSocketParticipants.includes(sanitizedParticipantName);
        
        // Добавляем в память только для отслеживания активных соединений
        if (!wasAlreadyConnected) {
          addParticipantToGroup(sanitizedCode, sanitizedParticipantName);
        }
        
        // Очищаем память от участников, которых нет в БД (источник истины)
        const staleParticipants = getGroupParticipants(sanitizedCode).filter(p => !dbParticipants.includes(p));
        staleParticipants.forEach(p => {
          removeParticipantFromGroup(sanitizedCode, p);
        });

        // Используем список участников из БД как источник истины
        const finalParticipants = dbParticipants;

        // ВАЖНО: Всегда отправляем актуальный список участников ВСЕМ участникам группы
        // Это гарантирует синхронизацию данных у всех пользователей
        io.to(sanitizedCode).emit('group:participant-joined', {
          participant: sanitizedParticipantName,
          participants: finalParticipants
        });

        // Загружаем и отправляем текущие фильмы новому участнику
        try {
          const films = await getFilmsByGroup(group.id);
          socket.emit('group:film-added', {
            films: films.map(f => ({
              id: f.id,
              kinopoiskId: f.kinopoiskId,
              title: f.title,
              year: f.year,
              poster: f.poster,
              description: f.description,
              rating: f.rating,
              addedBy: f.addedBy,
              addedAt: f.addedAt
            }))
          });
        } catch (error) {
          console.error('Error loading initial films:', error);
        }

        console.log(`Participant ${sanitizedParticipantName} joined group ${sanitizedCode}`);
      } catch (error) {
        console.error('Error joining group:', error);
        socket.emit('notification:error', { message: 'Ошибка присоединения к группе' });
      }
    });

    // Покидание группы
    socket.on('group:leave', (data) => {
      const { groupCode, participantName } = data;
      
      removeParticipantFromGroup(groupCode, participantName);
      removeSocketFromGroup(groupCode, socket.id);
      
      socket.leave(groupCode);
      
      // Уведомляем остальных участников
      const participants = getGroupParticipants(groupCode);
      socket.to(groupCode).emit('group:participant-left', {
        participant: participantName,
        participants
      });

      console.log(`Participant ${participantName} left group ${groupCode}`);
    });

    // Добавление фильма
    socket.on('film:add', async (data) => {
      try {
        const { groupCode, film } = data;
        
        // Валидация
        if (!groupCode || typeof groupCode !== 'string') {
          socket.emit('notification:error', { message: 'Неверный код группы' });
          return;
        }
        
        if (!film || !film.kinopoiskId) {
          socket.emit('notification:error', { message: 'Неверные данные фильма' });
          return;
        }

        const sanitizedCode = groupCode.trim().toUpperCase().slice(0, 10);
        if (!/^[A-Z0-9]{5}$/.test(sanitizedCode)) {
          socket.emit('notification:error', { message: 'Неверный формат кода группы' });
          return;
        }
        
        // Добавляем фильм в базу данных
        const group = await getGroupByCode(sanitizedCode);
        if (!group) {
          socket.emit('notification:error', { message: 'Группа не найдена' });
          return;
        }

        // Санитизация данных фильма
        const sanitizedFilm = {
          ...film,
          nameRu: film.nameRu ? String(film.nameRu).trim().slice(0, 200) : '',
          nameEn: film.nameEn ? String(film.nameEn).trim().slice(0, 200) : '',
          description: film.description ? String(film.description).trim().slice(0, 2000) : '',
          posterUrl: film.posterUrl ? String(film.posterUrl).trim().slice(0, 500) : '',
        };

        // Добавляем фильм
        const filmId = await addFilmToGroup({
          groupId: group.id,
          kinopoiskId: film.kinopoiskId,
          title: sanitizedFilm.nameRu,
          year: film.year && typeof film.year === 'number' && film.year > 1900 && film.year < 2100 ? film.year : undefined,
          poster: sanitizedFilm.posterUrl,
          description: sanitizedFilm.description,
          rating: film.ratingKinopoisk && typeof film.ratingKinopoisk === 'number' && film.ratingKinopoisk >= 0 && film.ratingKinopoisk <= 10 ? film.ratingKinopoisk : undefined,
          addedBy: socket.data.participantName || 'Участник'
        });

        // Создаем объект фильма для отправки (оптимизация: не делаем лишний запрос к БД)
        const newFilm = {
          id: filmId,
          kinopoiskId: film.kinopoiskId,
          title: sanitizedFilm.nameRu,
          year: film.year && typeof film.year === 'number' && film.year > 1900 && film.year < 2100 ? film.year : undefined,
          poster: sanitizedFilm.posterUrl,
          description: sanitizedFilm.description,
          rating: film.ratingKinopoisk && typeof film.ratingKinopoisk === 'number' && film.ratingKinopoisk >= 0 && film.ratingKinopoisk <= 10 ? film.ratingKinopoisk : undefined,
          addedBy: socket.data.participantName || 'Участник',
          addedAt: new Date().toISOString()
        };

        // Уведомляем всех участников группы (включая отправителя)
        // Клиенты сами добавят фильм в список оптимистично
        io.to(sanitizedCode).emit('group:film-added', {
          film: newFilm,
          films: null // Не отправляем весь список, клиенты обновят локально
        });

        console.log(`Film added to group ${sanitizedCode}:`, sanitizedFilm.nameRu);
      } catch (error) {
        console.error('Error adding film:', error);
        socket.emit('notification:error', { 
          message: error instanceof Error ? error.message : 'Ошибка добавления фильма' 
        });
      }
    });

    // Удаление фильма (только тот, кто добавил, может удалить)
    socket.on('film:remove', async (data) => {
      try {
        const { groupCode, filmId } = data;
        
        // Валидация
        if (!groupCode || typeof groupCode !== 'string') {
          socket.emit('notification:error', { message: 'Неверный код группы' });
          return;
        }
        
        if (!filmId || typeof filmId !== 'string') {
          socket.emit('notification:error', { message: 'Неверный ID фильма' });
          return;
        }

        const sanitizedCode = groupCode.trim().toUpperCase().slice(0, 10);
        if (!/^[A-Z0-9]{5}$/.test(sanitizedCode)) {
          socket.emit('notification:error', { message: 'Неверный формат кода группы' });
          return;
        }
        
        // Проверяем группу
        const group = await getGroupByCode(sanitizedCode);
        if (!group) {
          socket.emit('notification:error', { message: 'Группа не найдена' });
          return;
        }

        // Получаем фильм из базы данных
        const { getFilmsByGroup, deleteFilmById } = await import('@/lib/database');
        const films = await getFilmsByGroup(group.id);
        const film = films.find(f => f.id === filmId);
        
        if (!film) {
          socket.emit('notification:error', { message: 'Фильм не найден' });
          return;
        }

        // Проверяем, что пользователь добавил этот фильм
        if (film.addedBy !== socket.data.participantName) {
          socket.emit('notification:error', { message: 'Вы можете удалить только свои фильмы' });
          return;
        }

        // Удаляем фильм из базы данных
        await deleteFilmById(filmId);

        // Уведомляем всех участников группы
        io.to(sanitizedCode).emit('group:film-removed', {
          filmId: filmId,
          films: null // Клиенты обновят локально
        });

        console.log(`Film ${filmId} removed from group ${sanitizedCode} by ${socket.data.participantName}`);
      } catch (error) {
        console.error('Error removing film:', error);
        socket.emit('notification:error', { 
          message: error instanceof Error ? error.message : 'Ошибка удаления фильма' 
        });
      }
    });

    // Начало голосования (только создатель может начать)
    socket.on('voting:start', async (data) => {
      try {
        const { groupCode, films } = data;
        
        // Проверяем, существует ли группа и является ли пользователь создателем
        const group = await getGroupByCode(groupCode);
        if (!group) {
          socket.emit('notification:error', { message: 'Группа не найдена' });
          return;
        }

        // Проверяем, является ли пользователь создателем группы или эффективным создателем
        // (если создатель вышел, права передаются первому участнику)
        const participants = group.participants || [];
        const effectiveCreator = (group.createdBy && participants.includes(group.createdBy))
          ? group.createdBy
          : (participants.length > 0 ? participants[0] : null);
        
        if (!effectiveCreator || socket.data.participantName !== effectiveCreator) {
          socket.emit('notification:error', { message: 'Только создатель группы может начать голосование' });
          return;
        }

        // Уведомляем всех участников группы о начале голосования
        io.to(groupCode).emit('voting:started', { films });

        console.log(`Voting started in group ${groupCode} by ${socket.data.participantName}`);
      } catch (error) {
        console.error('Error starting voting:', error);
        socket.emit('notification:error', { message: 'Ошибка начала голосования' });
      }
    });

    // Сброс голосования и очистка фильмов/голосов (только создатель)
    socket.on('group:reset', async (data: { groupCode: string }) => {
      try {
        const { groupCode } = data;
        const requester = socket.data.participantName;
        if (!groupCode || !requester) return;

        const group = await getGroupByCode(groupCode);
        if (!group) {
          socket.emit('notification:error', { message: 'Группа не найдена' });
          return;
        }

        // Проверяем эффективного создателя (если создатель вышел, права у первого участника)
        const participants = group.participants || [];
        const effectiveCreator = (group.createdBy && participants.includes(group.createdBy))
          ? group.createdBy 
          : (participants.length > 0 ? participants[0] : null);
        
        if (!effectiveCreator || requester !== effectiveCreator) {
          socket.emit('notification:error', { message: 'Только создатель может начать новое голосование' });
          return;
        }

        await deleteFilmsByGroup(group.id);
        await deleteVotesByGroup(group.id);

        io.to(groupCode).emit('group:reset', { message: 'Голосование сброшено создателем' });
      } catch (error) {
        console.error('Error resetting group:', error);
        socket.emit('notification:error', { message: 'Не удалось сбросить голосование' });
      }
    });

    // Голосование
    socket.on('voting:vote', (data) => {
      const { groupCode, filmId, vote } = data;
      
      // Уведомляем всех участников группы о голосе
      socket.to(groupCode).emit('voting:vote-cast', {
        participant: socket.data.participantName,
        filmId,
        vote
      });

      console.log(`Vote cast in group ${groupCode}: ${socket.data.participantName} voted ${vote} for film ${filmId}`);
    });

    // Завершение голосования участником
    socket.on('voting:completed', async (data) => {
      try {
        const { groupCode, participantName } = data;
        
        // Проверяем, все ли участники завершили голосование
        const group = await getGroupByCode(groupCode);
        if (!group) {
          return;
        }

        // БД - единственный источник истины для списка участников
        const allParticipants = group.participants || [];
        
        if (allParticipants.length === 0) {
          console.warn(`No participants in group ${groupCode}`);
          return;
        }
        
        // Проверяем голоса в базе данных (источник истины)
        const votes = await getVotesByGroup(group.id);
        const films = await getFilmsByGroup(group.id);
        
        if (films.length === 0) {
          console.warn(`No films in group ${groupCode}`);
          return;
        }
        
        // Считаем, сколько фильмов проголосовано каждым участником
        const votesByParticipant = new Map<string, Set<number>>();
        votes.forEach(vote => {
          if (!votesByParticipant.has(vote.participantId)) {
            votesByParticipant.set(vote.participantId, new Set());
          }
          votesByParticipant.get(vote.participantId)!.add(vote.filmId);
        });

        // Определяем завершивших участников: те, кто проголосовал за все фильмы
        const completedParticipants = Array.from(allParticipants).filter(participant => {
          const participantVotes = votesByParticipant.get(participant);
          return participantVotes && participantVotes.size === films.length;
        });

        console.log(`Voting status in group ${groupCode}:`);
        console.log(`  Total participants: ${allParticipants.length}`);
        console.log(`  Total films: ${films.length}`);
        console.log(`  Completed: ${completedParticipants.length} (${completedParticipants.join(', ')})`);
        console.log(`  Votes in DB: ${votes.length}`);

        // Уведомляем всех о прогрессе
        io.to(groupCode).emit('voting:completed', { 
          participant: participantName,
          completedCount: completedParticipants.length,
          totalCount: allParticipants.length
        });

        // Проверяем, все ли участники завершили голосование
        if (completedParticipants.length === allParticipants.length && allParticipants.length > 0) {
          // Вычисляем результаты
          const results = calculateResults(votes, films, allParticipants);
          
          // Уведомляем всех участников о завершении
          io.to(groupCode).emit('voting:all-completed', { results });
          
          console.log(`All participants completed voting in group ${groupCode}`);
        }
      } catch (error) {
        console.error('Error processing voting completion:', error);
      }
    });

    // Отключение клиента
    socket.on('disconnect', async () => {
      const { groupCode, participantName } = socket.data;
      
      if (!groupCode || !participantName) {
        removeSocketFromGroup(groupCode || '', socket.id);
        return;
      }
      
      try {
        // Получаем группу из БД (источник истины)
        const group = await getGroupByCode(groupCode);
        
        if (!group) {
          removeParticipantFromGroup(groupCode, participantName);
          removeSocketFromGroup(groupCode, socket.id);
          return;
        }
        
        // Проверяем, является ли отключившийся участник создателем
        if (group.createdBy === participantName) {
          const remainingParticipants = (group.participants || []).filter(p => p !== participantName);
          
          if (remainingParticipants.length > 0) {
            const newCreator = remainingParticipants[0];
            try {
              const { updateGroup } = await import('@/lib/database');
              await updateGroup(group.id, { createdBy: newCreator });
              
              io.to(groupCode).emit('group:creator-changed', {
                newCreator,
                message: `Права создателя переданы участнику ${newCreator}`
              });
            } catch (err) {
              console.error('Error transferring creator rights:', err);
            }
          }
        }
        
        // Удаляем участника из БД (источник истины)
        const updatedParticipants = (group.participants || []).filter(p => p !== participantName);
        
        if (updatedParticipants.length !== group.participants.length) {
          try {
            const { updateGroup } = await import('@/lib/database');
            await updateGroup(group.id, { participants: updatedParticipants });
          } catch (err) {
            console.error('Error removing participant from database:', err);
          }
        }
        
        // Удаляем из памяти WebSocket
        removeParticipantFromGroup(groupCode, participantName);
        removeSocketFromGroup(groupCode, socket.id);
        
        // Получаем обновленный список из БД и уведомляем остальных
        const updatedGroup = await getGroupByCode(groupCode);
        const participants = updatedGroup?.participants || [];
        
        socket.to(groupCode).emit('group:participant-left', {
          participant: participantName,
          participants
        });
      } catch (error) {
        console.error('Error handling disconnect:', error);
        removeParticipantFromGroup(groupCode, participantName);
        removeSocketFromGroup(groupCode, socket.id);
      }
    });
  });

  res.end();
}
