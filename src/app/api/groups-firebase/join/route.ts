import { NextRequest, NextResponse } from 'next/server';
import { getGroupByCode, updateGroup } from '@/lib/database';

// POST /api/groups-firebase/join - присоединение к группе
export async function POST(request: NextRequest) {
  try {
    // Ограничение размера тела запроса (1MB)
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 1024 * 1024) {
      return NextResponse.json(
        { error: 'Размер запроса слишком большой' },
        { status: 413 }
      );
    }

    const body = await request.json();
    const { code, participantName } = body;

    if (!code || !participantName) {
      return NextResponse.json(
        { error: 'Код группы и имя участника обязательны' },
        { status: 400 }
      );
    }

    // Валидация и санитизация
    const sanitizedCode = code.toString().trim().toUpperCase().slice(0, 10);
    const sanitizedParticipantName = participantName.toString().trim().slice(0, 50);
    
    if (sanitizedCode.length === 0 || sanitizedParticipantName.length === 0) {
      return NextResponse.json(
        { error: 'Код группы и имя участника не могут быть пустыми' },
        { status: 400 }
      );
    }

    // Валидация формата кода группы (5 символов, буквы и цифры)
    if (!/^[A-Z0-9]{5}$/.test(sanitizedCode)) {
      return NextResponse.json(
        { error: 'Неверный формат кода группы' },
        { status: 400 }
      );
    }

    // Получаем группу
    const group = await getGroupByCode(sanitizedCode);
    if (!group) {
      return NextResponse.json(
        { error: 'Группа с таким кодом не найдена' },
        { status: 404 }
      );
    }

    // Проверяем, не является ли участник уже членом группы
    if (group.participants.includes(sanitizedParticipantName)) {
      return NextResponse.json(
        { error: 'Вы уже являетесь участником этой группы' },
        { status: 400 }
      );
    }

    // Добавляем участника
    const updatedParticipants = [...group.participants, sanitizedParticipantName];
    await updateGroup(group.id, { participants: updatedParticipants });

    return NextResponse.json({
      success: true,
      data: {
        ...group,
        participants: updatedParticipants
      }
    });

  } catch (error) {
    console.error('Ошибка присоединения к группе:', error);
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 }
    );
  }
}
