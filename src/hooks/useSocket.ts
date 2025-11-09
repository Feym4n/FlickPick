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
        // На Vercel лучше использовать polling как основной транспорт
        socketInstance = io(socketUrl, {
          path: '/api/socket',
          transports: ['polling', 'websocket'], // Polling первым для лучшей совместимости с Vercel
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
    if (!socket || !isConnected) return;

    // Подключаемся к группе
    socket.emit('group:join', { groupCode, participantName });

    // Слушаем события группы
    socket.on('group:participant-joined', (data) => {
      setParticipants(data.participants);
    });

    socket.on('group:participant-left', (data) => {
      setParticipants(data.participants);
    });

    socket.on('group:film-added', (data) => {
      setFilms(data.films);
    });

    socket.on('group:film-removed', (data) => {
      setFilms(data.films);
    });

    socket.on('voting:started', () => {
      console.log('Voting started, redirecting to voting page');
      // Автоматически перенаправляем на страницу голосования
      window.location.href = `/vote/${groupCode}?nickname=${encodeURIComponent(participantName)}`;
    });

    socket.on('voting:vote-cast', (data) => {
      console.log(`${data.participant} voted ${data.vote} for film ${data.filmId}`);
    });

    socket.on('voting:completed', (data: { participant: string }) => {
      console.log('Participant completed voting:', data.participant);
      setCompletedParticipants(prev => {
        if (!prev.includes(data.participant)) {
          return [...prev, data.participant];
        }
        return prev;
      });
    });

    socket.on('group:creator-changed', (data) => {
      console.log('Creator changed:', data.newCreator, data.message);
      // Обновляем список участников, если нужно
      // Это событие будет обработано в GroupPageClient через перезагрузку группы
    });

    socket.on('voting:all-completed', () => {
      console.log('All participants completed voting, redirecting to results');
      // Получаем никнейм из sessionStorage для передачи в результаты
      const nickname = typeof window !== 'undefined' 
        ? sessionStorage.getItem(`nickname_${groupCode}`) || participantName
        : participantName;
      // Перенаправляем на страницу результатов с никнеймом
      window.location.href = `/results/${groupCode}?nickname=${encodeURIComponent(nickname)}`;
    });

    socket.on('notification:error', (data) => {
      console.error('Socket error:', data.message);
    });

    socket.on('group:closed', (data) => {
      console.log('Group closed:', data.message);
      // Перенаправляем пользователя на главную страницу, если группа закрыта
      if (typeof window !== 'undefined') {
        alert('Группа была закрыта создателем');
        window.location.href = '/';
      }
    });

    socket.on('group:reset', () => {
      // Очищаем локально и возвращаемся в группу
      setFilms([]);
      const nickname = typeof window !== 'undefined' 
        ? (sessionStorage.getItem(`nickname_${groupCode}`) || participantName)
        : participantName;
      window.location.href = `/group/${groupCode}?nickname=${encodeURIComponent(nickname)}`;
    });

    // Очистка при размонтировании
    return () => {
      socket.emit('group:leave', { groupCode, participantName });
      socket.off('group:participant-joined');
      socket.off('group:participant-left');
      socket.off('group:film-added');
      socket.off('group:film-removed');
      socket.off('voting:started');
      socket.off('voting:vote-cast');
      socket.off('voting:completed');
      socket.off('voting:all-completed');
      socket.off('notification:error');
      socket.off('group:closed');
      socket.off('group:reset');
    };
  }, [socket, isConnected, groupCode, participantName]);

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
