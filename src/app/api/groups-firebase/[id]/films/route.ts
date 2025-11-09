import { NextRequest, NextResponse } from 'next/server';
import { getGroupByCode, addFilmToGroup, getFilmsByGroup } from '@/lib/database';

// POST /api/groups-firebase/[id]/films - добавление фильма в группу
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: groupCode } = await params;
    
    // Ограничение размера тела запроса (1MB)
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 1024 * 1024) {
      return NextResponse.json(
        { error: 'Размер запроса слишком большой' },
        { status: 413 }
      );
    }

    const body = await request.json();
    const { film } = body;

    if (!film) {
      return NextResponse.json(
        { error: 'Фильм не указан' },
        { status: 400 }
      );
    }

    // Валидация данных фильма
    if (!film.kinopoiskId || typeof film.kinopoiskId !== 'number' || film.kinopoiskId <= 0) {
      return NextResponse.json(
        { error: 'Неверный ID фильма' },
        { status: 400 }
      );
    }

    // Санитизация строковых полей
    const sanitizedFilm = {
      ...film,
      nameRu: film.nameRu ? String(film.nameRu).trim().slice(0, 200) : '',
      nameEn: film.nameEn ? String(film.nameEn).trim().slice(0, 200) : '',
      description: film.description ? String(film.description).trim().slice(0, 2000) : '',
      posterUrl: film.posterUrl ? String(film.posterUrl).trim().slice(0, 500) : '',
      year: film.year && typeof film.year === 'number' && film.year > 1900 && film.year < 2100 ? film.year : undefined,
      ratingKinopoisk: film.ratingKinopoisk && typeof film.ratingKinopoisk === 'number' && film.ratingKinopoisk >= 0 && film.ratingKinopoisk <= 10 ? film.ratingKinopoisk : undefined,
    };

    // Получаем группу
    const group = await getGroupByCode(groupCode);
    if (!group) {
      return NextResponse.json(
        { error: 'Группа не найдена' },
        { status: 404 }
      );
    }

    // Добавляем фильм в группу
    await addFilmToGroup({
      groupId: group.id,
      kinopoiskId: sanitizedFilm.kinopoiskId,
      title: sanitizedFilm.nameRu,
      year: sanitizedFilm.year,
      poster: sanitizedFilm.posterUrl,
      description: sanitizedFilm.description,
      rating: sanitizedFilm.ratingKinopoisk,
      addedBy: 'Пользователь' // TODO: Получать реальное имя
    });

    // Получаем обновленный список фильмов
    const films = await getFilmsByGroup(group.id);

    return NextResponse.json({
      success: true,
      data: {
        ...group,
        films
      }
    });

  } catch (error) {
    console.error('Ошибка добавления фильма:', error);
    
    // Более детальная обработка ошибок
    if (error instanceof Error) {
      if (error.message.includes('уже добавлен')) {
        return NextResponse.json(
          { error: 'Этот фильм уже добавлен в группу' },
          { status: 400 }
        );
      }
      if (error.message.includes('index')) {
        return NextResponse.json(
          { error: 'Ошибка базы данных: требуется настройка индексов' },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: `Ошибка: ${error.message}` },
        { status: 500 }
      );
    }
    
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 }
    );
  }
}
