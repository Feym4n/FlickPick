'use client';

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Users, Plus, Play, Film as FilmIcon, Wifi, WifiOff, Copy, Check } from "lucide-react";
import FilmSearch from "@/components/FilmSearch";
import { KinopoiskFilm } from "@/services/kinopoisk";
import { Film } from "@/lib/database";
import { useGroupSocket } from "@/hooks/useSocket";

interface GroupPageClientProps {
  groupCode: string;
}

export default function GroupPageClient({ groupCode }: GroupPageClientProps) {
  const [isCreator, setIsCreator] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showFilmSearch, setShowFilmSearch] = useState(false);
  const [initialParticipants, setInitialParticipants] = useState<string[]>([]);
  const [initialFilms, setInitialFilms] = useState<Film[]>([]);
  
  // Получаем никнейм из URL параметров, sessionStorage или используем дефолтный
  const [participantName] = useState(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const nicknameFromUrl = urlParams.get('nickname');
      
      if (nicknameFromUrl) {
        // Сохраняем никнейм в sessionStorage для последующего использования
        sessionStorage.setItem(`nickname_${groupCode}`, nicknameFromUrl);
        return nicknameFromUrl;
      }
      
      // Пробуем получить из sessionStorage
      const nicknameFromStorage = sessionStorage.getItem(`nickname_${groupCode}`);
      if (nicknameFromStorage) {
        return nicknameFromStorage;
      }
      
      return 'Участник';
    }
    return 'Участник';
  });

  // Используем WebSocket для реального времени
  const { 
    socket,
    isConnected, 
    participants, 
    films, 
    addFilm: addFilmRealtime,
    startVoting: startVotingRealtime
  } = useGroupSocket(groupCode, participantName);

  // Используем участников из WebSocket, если они есть, иначе из начальной загрузки
  const displayParticipants = participants.length > 0 ? participants : initialParticipants;
  
  // Используем фильмы из WebSocket, если они есть, иначе из начальной загрузки
  const displayFilms = films.length > 0 ? films : initialFilms;
  
  // Периодическая синхронизация, если WebSocket не подключен
  useEffect(() => {
    if (!isConnected) {
      const syncInterval = setInterval(async () => {
        try {
          const response = await fetch(`/api/groups-firebase?code=${groupCode}`);
          const data = await response.json();
          if (data.success) {
            setInitialParticipants(data.data.participants || []);
            
            const filmsResponse = await fetch(`/api/groups-firebase/${groupCode}/films`);
            if (filmsResponse.ok) {
              const filmsData = await filmsResponse.json();
              if (filmsData.success && filmsData.data) {
                setInitialFilms(filmsData.data);
              }
            }
          }
        } catch (error) {
          console.error('Ошибка синхронизации данных:', error);
        }
      }, 2000); // Синхронизация каждые 2 секунды, если WebSocket не работает
      
      return () => clearInterval(syncInterval);
    }
  }, [isConnected, groupCode]);
  
  // Обновляем начальные данные при получении событий WebSocket
  useEffect(() => {
    if (participants.length > 0) {
      setInitialParticipants(participants);
    }
  }, [participants]);
  
  useEffect(() => {
    if (films.length > 0) {
      setInitialFilms(films);
    }
  }, [films]);

  // Загружаем данные группы для определения создателя
  useEffect(() => {
    const loadGroup = async () => {
      try {
        const response = await fetch(`/api/groups-firebase?code=${groupCode}`);
        const data = await response.json();

        if (data.success) {
          const creator = data.data.createdBy;
          const participants = data.data.participants || [];
          
          // Сохраняем участников для начального отображения
          setInitialParticipants(participants);
          
          // Загружаем фильмы для начального отображения
          try {
            const filmsResponse = await fetch(`/api/groups-firebase/${groupCode}/films`);
            if (filmsResponse.ok) {
              const filmsData = await filmsResponse.json();
              if (filmsData.success && filmsData.data) {
                setInitialFilms(filmsData.data);
              }
            }
          } catch (err) {
            console.error('Ошибка загрузки фильмов:', err);
          }
          
          // Если создатель не в списке участников, передаем права первому участнику
          let effectiveCreator = creator;
          if (creator && !participants.includes(creator) && participants.length > 0) {
            effectiveCreator = participants[0];
            // Обновляем createdBy в базе данных
            try {
              await fetch(`/api/groups-firebase/${groupCode}/transfer-creator`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newCreator: effectiveCreator })
              });
            } catch (err) {
              console.error('Ошибка передачи прав создателя:', err);
            }
          } else if (!creator && participants.length > 0) {
            // Если создателя вообще нет, назначаем первого участника
            effectiveCreator = participants[0];
          }
          
          setIsCreator(participantName === effectiveCreator);
        } else {
          console.error('Ошибка загрузки группы:', data.error);
        }
      } catch (error) {
        console.error('Ошибка загрузки группы:', error);
      }
    };

    if (groupCode) {
      loadGroup();
    }
  }, [groupCode, participantName]);

  // Обработчик событий WebSocket для обновления участников
  // Убрали проверку isConnected - обработчики работают всегда
  useEffect(() => {
    if (!socket) return;

    const handleParticipantJoined = (data: { participant: string; participants: string[] }) => {
      // Сразу обновляем начальные данные для мгновенного отображения
      if (data.participants && data.participants.length > 0) {
        setInitialParticipants(data.participants);
      }
    };

    const handleParticipantLeft = (data: { participant: string; participants: string[] }) => {
      if (data.participants) {
        setInitialParticipants(data.participants);
      }
    };

    socket.on('group:participant-joined', handleParticipantJoined);
    socket.on('group:participant-left', handleParticipantLeft);

    return () => {
      socket.off('group:participant-joined', handleParticipantJoined);
      socket.off('group:participant-left', handleParticipantLeft);
    };
  }, [socket]);

  // Обработчик события смены создателя через WebSocket
  // Убрали проверку isConnected
  useEffect(() => {
    if (!socket) return;

    const handleCreatorChanged = (data: { newCreator: string; message: string }) => {
      console.log('Creator changed event received:', data);
      setIsCreator(participantName === data.newCreator);
      // Перезагружаем данные группы для синхронизации
      const loadGroup = async () => {
        try {
          const response = await fetch(`/api/groups-firebase?code=${groupCode}`);
          const data = await response.json();
          if (data.success) {
            const creator = data.data.createdBy;
            const participants = data.data.participants || [];
            const effectiveCreator = participants.includes(creator) 
              ? creator 
              : (participants.length > 0 ? participants[0] : null);
            setIsCreator(participantName === effectiveCreator);
          }
        } catch (error) {
          console.error('Ошибка перезагрузки группы:', error);
        }
      };
      loadGroup();
    };

    socket.on('group:creator-changed', handleCreatorChanged);

    return () => {
      socket.off('group:creator-changed', handleCreatorChanged);
    };
  }, [socket, groupCode, participantName]);

  const handleAddFilm = async (film: KinopoiskFilm) => {
    try {
      // Всегда пытаемся использовать WebSocket, если он есть
      // Socket.IO сам обработает очередь, если еще не подключен
      if (socket) {
        addFilmRealtime(film);
        setShowFilmSearch(false);
      } else {
        // Fallback на обычный API, если socket вообще нет
        const response = await fetch(`/api/groups-firebase/${groupCode}/films`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ film }),
        });

        const data = await response.json();

        if (data.success) {
          setShowFilmSearch(false);
        } else {
          alert(data.error || 'Ошибка добавления фильма');
        }
      }
    } catch (error) {
      console.error('Ошибка добавления фильма:', error);
      alert('Ошибка добавления фильма');
    }
  };

  const handleStartVoting = () => {
    if (displayFilms.length === 0) {
      alert('Добавьте хотя бы один фильм перед началом голосования');
      return;
    }
    
    // Всегда пытаемся использовать WebSocket, если он есть
    // Socket.IO сам обработает отправку при подключении
    if (socket && startVotingRealtime) {
      startVotingRealtime(displayFilms);
    } else {
      // Fallback: переход только для текущего пользователя
      window.location.href = `/vote/${groupCode}?nickname=${encodeURIComponent(participantName)}`;
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-black via-gray-900 to-gray-800 text-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => window.location.href = '/'}
            className="mr-4 text-gray-400 hover:text-white"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
                 <div>
                   <div className="flex items-center gap-2">
                     <h1 className="text-xl font-bold">Группа {groupCode}</h1>
                     {isConnected ? (
                       <Wifi className="h-4 w-4 text-green-500" />
                     ) : (
                       <WifiOff className="h-4 w-4 text-red-500" />
                     )}
                   </div>
                   <p className="text-sm text-gray-400">Код для приглашения друзей</p>
                 </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tracking-widest">{groupCode}</div>
          <Button
            size="sm"
            className="mt-1 text-xs bg-gray-800 border border-gray-700 text-white hover:bg-gray-700 hover:border-gray-600 transition-all duration-200"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(groupCode);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch (err) {
                console.error('Ошибка копирования:', err);
              }
            }}
          >
            {copied ? (
              <span className="flex items-center gap-1">
                <Check className="h-3 w-3" />
                Скопировано
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Copy className="h-3 w-3" />
                Копировать
              </span>
            )}
          </Button>
        </div>
      </div>

      <div className="flex-1 p-4">
        {/* Participants */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-8"
        >
          <div className="flex items-center mb-4">
            <Users className="h-5 w-5 mr-2" />
            <h2 className="text-lg font-semibold">Участники</h2>
            <span className="ml-2 text-sm text-gray-400">({displayParticipants.length})</span>
          </div>
          
          <div className="bg-gray-800 rounded-xl p-4 min-h-[100px] flex items-center justify-center">
            {displayParticipants.length === 0 ? (
              <p className="text-gray-400 text-center">
                Пока никто не присоединился к группе
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {displayParticipants.map((participant, index) => (
                  <div
                    key={index}
                    className="bg-pink-600 px-3 py-1 rounded-full text-sm"
                  >
                    {participant}
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>

        {/* Films */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="mb-8"
        >
          <div className="flex items-center justify-between mb-4">
             <div className="flex items-center">
               <FilmIcon className="h-5 w-5 mr-2" />
               <h2 className="text-lg font-semibold">Фильмы</h2>
               <span className="ml-2 text-sm text-gray-400">({displayFilms.length})</span>
             </div>
            <Button
              onClick={() => setShowFilmSearch(!showFilmSearch)}
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              <Plus className="h-4 w-4 mr-1" />
              {showFilmSearch ? 'Скрыть поиск' : 'Добавить фильм'}
            </Button>
          </div>

          {/* Поиск фильмов */}
          {showFilmSearch && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6"
            >
              <FilmSearch onAddFilm={handleAddFilm} />
            </motion.div>
          )}
          
          {/* Список фильмов */}
          <div className="bg-gray-800 rounded-xl p-4 min-h-[200px]">
            {displayFilms.length === 0 ? (
               <div className="flex items-center justify-center h-48">
                 <div className="text-center">
                   <FilmIcon className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                   <p className="text-gray-400 mb-2">Фильмы еще не добавлены</p>
                   <p className="text-sm text-gray-500">
                     Используйте поиск выше, чтобы добавить фильмы
                   </p>
                 </div>
               </div>
            ) : (
               <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                 {displayFilms.map((film) => (
                   <div key={film.id} className="max-w-xs mx-auto">
                     <div className="bg-gray-700 rounded-xl overflow-hidden shadow-lg">
                       {/* Постер */}
                       <div className="relative aspect-[2/3] bg-gray-600">
                         <img
                           src={film.poster || '/placeholder-poster.jpg'}
                           alt={film.title}
                           className="w-full h-full object-cover"
                           onError={(e) => {
                             const target = e.target as HTMLImageElement;
                             target.src = '/placeholder-poster.jpg';
                           }}
                         />
                         
                         {/* Рейтинг */}
                         {film.rating && (
                           <div className="absolute top-2 right-2 bg-black bg-opacity-70 text-white px-2 py-1 rounded-lg flex items-center gap-1 text-sm">
                             <span className="text-yellow-400">★</span>
                             {film.rating.toFixed(1)}
                           </div>
                         )}
                       </div>

                       {/* Информация о фильме */}
                       <div className="p-4">
                         <h3 className="font-bold text-white text-lg mb-2 line-clamp-2">
                           {film.title}
                         </h3>
                         
                         <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
                           <span>{film.year}</span>
                         </div>

                         {/* Описание */}
                         {film.description && (
                           <p className="text-gray-400 text-sm line-clamp-3">
                             {film.description}
                           </p>
                         )}
                       </div>
                     </div>
                   </div>
                 ))}
               </div>
            )}
          </div>
        </motion.div>

        {/* Actions */}
        {isCreator && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
          >
            <Button
              onClick={handleStartVoting}
              disabled={displayFilms.length < 2 || displayParticipants.length < 2}
              className="w-full py-4 text-lg bg-pink-600 hover:bg-pink-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-xl shadow-lg transition"
            >
              <Play className="h-5 w-5 mr-2" />
              Начать выбор фильма
            </Button>
            <p className="text-xs text-gray-400 mt-2 text-center">
              {displayFilms.length < 2 || displayParticipants.length < 2
                ? 'Нужно минимум 2 участника и 2 фильма для начала голосования'
                : 'Готово к началу голосования'}
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}

