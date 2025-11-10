/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { ServerToClientEvents, ClientToServerEvents } from '@/lib/socket';

type SocketType = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useSocket() {
  const [socket, setSocket] = useState<SocketType | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    let socketInstance: SocketType | null = null;
    let isMounted = true;

    // Функция инициализации Socket.IO
    const initializeSocket = async () => {
      try {
        // Сначала делаем HTTP-запрос для инициализации Socket.IO сервера
        const socketUrl = typeof window !== 'undefined' 
          ? window.location.origin 
          : (process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3000');
        
        // Принудительно инициализируем Socket.IO сервер через HTTP-запрос
        await fetch(`${socketUrl}/api/socket`, {
          method: 'GET',
        }).catch(() => {
          // Игнорируем ошибки, так как это просто триггер инициализации
          console.log('Socket server initialization trigger sent');
        });

        // Небольшая задержка для инициализации сервера
        await new Promise(resolve => setTimeout(resolve, 100));

        if (!isMounted) return;

        // Создаем Socket.IO подключение
        // На Railway можно использовать websocket как основной транспорт (лучше производительность)
        socketInstance = io(socketUrl, {
          path: '/api/socket',
          transports: ['websocket', 'polling'], // WebSocket первым для лучшей производительности на Railway
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          reconnectionAttempts: Infinity, // Бесконечные попытки переподключения
          timeout: 20000,
          forceNew: false,
          upgrade: true,
        });

        socketInstance.on('connect', () => {
          console.log('✅ Socket connected:', socketInstance?.id);
          if (isMounted) {
            setIsConnected(true);
          }
        });

        socketInstance.on('disconnect', (reason) => {
          console.log('❌ Socket disconnected:', reason);
          if (isMounted) {
            setIsConnected(false);
          }
        });

        socketInstance.on('connect_error', (error) => {
          console.error('⚠️ Socket connection error:', error.message);
          if (isMounted) {
            setIsConnected(false);
          }
        });

        // Обработчики событий переподключения (используем any для совместимости с типами)
        socketInstance.on('reconnect' as any, (attemptNumber: number) => {
          console.log('✅ Socket reconnected after', attemptNumber, 'attempts');
          if (isMounted) {
            setIsConnected(true);
          }
        });

        socketInstance.on('reconnect_attempt' as any, (attemptNumber: number) => {
          console.log('🔄 Reconnection attempt', attemptNumber);
        });

        socketInstance.on('reconnect_error' as any, (error: Error) => {
          console.error('⚠️ Reconnection error:', error.message);
        });

        socketInstance.on('reconnect_failed' as any, () => {
          console.error('❌ Reconnection failed');
        });

        if (isMounted) {
          setSocket(socketInstance);
        }
      } catch (error) {
        console.error('Error initializing socket:', error);
      }
    };

    initializeSocket();

    return () => {
      isMounted = false;
      if (socketInstance) {
        socketInstance.close();
        socketInstance = null;
      }
    };
  }, []);

  return { socket, isConnected };
}

export function useGroupSocket(groupCode: string, participantName: string) {
  const { socket, isConnected } = useSocket();
  const [participants, setParticipants] = useState<string[]>([]);
  const [films, setFilms] = useState<any[]>([]);
  const [completedParticipants, setCompletedParticipants] = useState<string[]>([]);

  useEffect(() => {
    if (!socket) return;

    // Устанавливаем обработчики событий сразу, даже если еще не подключен
    // Это важно для получения событий при переподключении
    
    // Обработчик начала голосования - должен работать всегда
    const handleVotingStarted = () => {
      console.log('Voting started, redirecting to voting page');
      const nickname = typeof window !== 'undefined' 
        ? (sessionStorage.getItem(`nickname_${groupCode}`) || participantName)
        : participantName;
      window.location.href = `/vote/${groupCode}?nickname=${encodeURIComponent(nickname)}`;
    };

    // Слушаем события группы
    const handleParticipantJoined = (data: { participant: string; participants: string[] }) => {
      setParticipants(data.participants);
    };

    const handleParticipantLeft = (data: { participant: string; participants: string[] }) => {
      setParticipants(data.participants);
    };

    const handleFilmAdded = (data: { film: any; films: any[] | null }) => {
      // Если сервер отправил полный список, используем его
      // Иначе добавляем только новый фильм (оптимизация)
      if (data.films && Array.isArray(data.films)) {
        setFilms(data.films);
      } else if (data.film) {
        // Оптимистичное обновление: добавляем только новый фильм
        setFilms(prev => {
          // Проверяем, нет ли уже такого фильма
          if (prev.some(f => f.kinopoiskId === data.film.kinopoiskId)) {
            return prev;
          }
          return [...prev, data.film];
        });
      }
    };

    const handleFilmRemoved = (data: { filmId: string; films: any[] }) => {
      setFilms(data.films);
    };

    const handleVoteCast = (data: { participant: string; filmId: number; vote: 'like' | 'dislike' }) => {
      console.log(`${data.participant} voted ${data.vote} for film ${data.filmId}`);
    };

    const handleVotingCompleted = (data: { participant: string; completedCount?: number; totalCount?: number }) => {
      console.log('Participant completed voting:', data.participant, `(${data.completedCount || '?'}/${data.totalCount || '?'})`);
      setCompletedParticipants(prev => {
        if (!prev.includes(data.participant)) {
          return [...prev, data.participant];
        }
        return prev;
      });
    };

    const handleCreatorChanged = (data: { newCreator: string; message: string }) => {
      console.log('Creator changed:', data.newCreator, data.message);
    };

    const handleVotingAllCompleted = () => {
      console.log('All participants completed voting, redirecting to results');
      const nickname = typeof window !== 'undefined' 
        ? sessionStorage.getItem(`nickname_${groupCode}`) || participantName
        : participantName;
      window.location.href = `/results/${groupCode}?nickname=${encodeURIComponent(nickname)}`;
    };

    const handleNotificationError = (data: { message: string }) => {
      console.error('Socket error:', data.message);
    };

    const handleGroupClosed = (data: { message: string }) => {
      console.log('Group closed:', data.message);
      if (typeof window !== 'undefined') {
        alert('Группа была закрыта создателем');
        window.location.href = '/';
      }
    };

    const handleGroupReset = () => {
      setFilms([]);
      const nickname = typeof window !== 'undefined' 
        ? (sessionStorage.getItem(`nickname_${groupCode}`) || participantName)
        : participantName;
      window.location.href = `/group/${groupCode}?nickname=${encodeURIComponent(nickname)}`;
    };

    // Регистрируем все обработчики сразу
    socket.on('voting:started', handleVotingStarted);
    socket.on('group:participant-joined', handleParticipantJoined);
    socket.on('group:participant-left', handleParticipantLeft);
    socket.on('group:film-added', handleFilmAdded);
    socket.on('group:film-removed', handleFilmRemoved);
    socket.on('voting:vote-cast', handleVoteCast);
    socket.on('voting:completed', handleVotingCompleted);
    socket.on('group:creator-changed', handleCreatorChanged);
    socket.on('voting:all-completed', handleVotingAllCompleted);
    socket.on('notification:error', handleNotificationError);
    socket.on('group:closed', handleGroupClosed);
    socket.on('group:reset', handleGroupReset);

    // Функция для подключения к группе
    // ВАЖНО: Используем имя из sessionStorage при переподключении
    const joinGroup = () => {
      if (socket.connected) {
        // При переподключении используем сохраненное имя из sessionStorage
        const savedName = typeof window !== 'undefined' 
          ? sessionStorage.getItem(`nickname_${groupCode}`) || participantName
          : participantName;
        socket.emit('group:join', { groupCode, participantName: savedName });
      }
    };

    // Подключаемся к группе при подключении socket
    if (socket.connected) {
      joinGroup();
    } else {
      // Если еще не подключен, ждем подключения
      socket.once('connect', joinGroup);
    }

    // Также обрабатываем переподключение
    const handleReconnect = () => {
      console.log('Socket reconnected, rejoining group');
      joinGroup();
      
      // ВАЖНО: После переподключения проверяем состояние голосования
      // Если голосование уже начато, перенаправляем пользователя
      if (typeof window !== 'undefined') {
        const checkVotingStatus = async () => {
          try {
            const votesResponse = await fetch(`/api/groups-firebase/${groupCode}/votes`);
            if (votesResponse.ok) {
              const votesData = await votesResponse.json();
              const votes = votesData.data?.votes || [];
              if (votesData.success && votes.length > 0) {
                // Голосование начато - перенаправляем
                console.log('Voting already started, redirecting after reconnect...');
                const nickname = sessionStorage.getItem(`nickname_${groupCode}`) || participantName;
                window.location.href = `/vote/${groupCode}?nickname=${encodeURIComponent(nickname)}`;
              }
            }
          } catch (error) {
            console.error('Ошибка проверки состояния голосования при переподключении:', error);
          }
        };
        // Небольшая задержка, чтобы дать время на переподключение к группе
        setTimeout(checkVotingStatus, 1000);
      }
    };
    
    socket.on('reconnect' as any, handleReconnect);

    // Очистка при размонтировании
    return () => {
      socket.emit('group:leave', { groupCode, participantName });
      socket.off('group:participant-joined', handleParticipantJoined);
      socket.off('group:participant-left', handleParticipantLeft);
      socket.off('group:film-added', handleFilmAdded);
      socket.off('group:film-removed', handleFilmRemoved);
      socket.off('voting:started', handleVotingStarted);
      socket.off('voting:vote-cast', handleVoteCast);
      socket.off('voting:completed', handleVotingCompleted);
      socket.off('voting:all-completed', handleVotingAllCompleted);
      socket.off('group:creator-changed', handleCreatorChanged);
      socket.off('notification:error', handleNotificationError);
      socket.off('group:closed', handleGroupClosed);
      socket.off('group:reset', handleGroupReset);
    };
  }, [socket, groupCode, participantName]);

  const addFilm = (film: any) => {
    if (socket) {
      socket.emit('film:add', { groupCode, film });
    }
  };

  const castVote = (filmId: number, vote: 'like' | 'dislike') => {
    if (socket) {
      socket.emit('voting:vote', { groupCode, filmId, vote });
    }
  };

  const startVoting = (filmsToVote: any[]) => {
    if (socket) {
      socket.emit('voting:start', { groupCode, films: filmsToVote });
    }
  };

  const completeVoting = () => {
    if (socket) {
      socket.emit('voting:completed', { groupCode, participantName });
    }
  };

  const resetGroup = () => {
    if (socket) {
      socket.emit('group:reset', { groupCode });
    }
  };

  return {
    socket,
    isConnected,
    participants,
    films,
    completedParticipants,
    addFilm,
    castVote,
    startVoting,
    completeVoting
    , resetGroup
  };
}
