import { NextRequest, NextResponse } from 'next/server';
import { getGroupByCode, addVotes, getVotesByGroup, deleteVotesByGroup } from '@/lib/database';

// POST /api/groups-firebase/[id]/votes - сохранение голосов
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
    const { votes } = body;

    // Нормализуем код группы (верхний регистр, без пробелов)
    const normalizedCode = groupCode?.toUpperCase().trim();
    
    // Логируем только метаданные, не сами голоса
    console.log('Saving votes for group:', {
      original: groupCode,
      normalized: normalizedCode,
      votesCount: votes?.length
    });

    if (!votes || !Array.isArray(votes)) {
      console.error('Invalid votes format:', votes);
      return NextResponse.json(
        { error: 'Неверный формат голосов' },
        { status: 400 }
      );
    }

    if (!normalizedCode) {
      console.error('Group code is missing or invalid');
      return NextResponse.json(
        { error: 'Код группы не указан' },
        { status: 400 }
      );
    }

    // Получаем группу
    const group = await getGroupByCode(normalizedCode);
    if (!group) {
      console.error('Group not found:', normalizedCode);
      // Пробуем найти все группы для отладки
      console.error('Attempting to find group with code:', normalizedCode);
      return NextResponse.json(
        { error: `Группа с кодом "${normalizedCode}" не найдена` },
        { status: 404 }
      );
    }

    console.log('Group found:', group.id, group.code);

    // Валидация голосов
    const validVotes = votes.filter((vote: { filmId: number; vote: string; participantId?: string }) => {
      // Проверка типов и значений
      if (!vote.filmId || typeof vote.filmId !== 'number' || vote.filmId <= 0) {
        return false;
      }
      if (vote.vote !== 'like' && vote.vote !== 'dislike') {
        return false;
      }
      // Санитизация participantId
      if (vote.participantId && typeof vote.participantId === 'string') {
        vote.participantId = vote.participantId.trim().slice(0, 50);
      }
      return true;
    });

    if (validVotes.length === 0) {
      return NextResponse.json(
        { error: 'Нет валидных голосов' },
        { status: 400 }
      );
    }

    // Сохраняем голоса с санитизацией participantId
    await addVotes(validVotes.map(vote => ({
      groupId: group.id,
      filmId: vote.filmId,
      vote: vote.vote as 'like' | 'dislike',
      participantId: vote.participantId ? vote.participantId.trim().slice(0, 50) : 'Участник'
    })));

    return NextResponse.json({
      success: true,
      message: 'Голоса успешно сохранены'
    });

  } catch (error) {
    console.error('Ошибка сохранения голосов:', error);
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 }
    );
  }
}

// GET /api/groups-firebase/[id]/votes - получение голосов
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: groupCode } = await params;

    const group = await getGroupByCode(groupCode);
    if (!group) {
      return NextResponse.json(
        { error: 'Группа не найдена' },
        { status: 404 }
      );
    }

    const votes = await getVotesByGroup(group.id);

    return NextResponse.json({
      success: true,
      data: { votes }
    });

  } catch (error) {
    console.error('Ошибка получения голосов:', error);
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 }
    );
  }
}

// DELETE /api/groups-firebase/[id]/votes - удаление всех голосов группы
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: groupCode } = await params;
    const normalizedCode = groupCode?.toUpperCase().trim();

    if (!normalizedCode) {
      return NextResponse.json(
        { error: 'Код группы не указан' },
        { status: 400 }
      );
    }

    const group = await getGroupByCode(normalizedCode);
    if (!group) {
      return NextResponse.json(
        { error: 'Группа не найдена' },
        { status: 404 }
      );
    }

    await deleteVotesByGroup(group.id);

    return NextResponse.json({
      success: true,
      message: 'Все голоса успешно удалены'
    });

  } catch (error) {
    console.error('Ошибка удаления голосов:', error);
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 }
    );
  }
}
