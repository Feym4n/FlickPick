import { NextRequest, NextResponse } from 'next/server';
import { getGroupByCode, updateGroup } from '@/lib/database';

// POST /api/groups-firebase/[id]/transfer-creator - передача прав создателя
export async function POST(
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

    const body = await request.json();
    const { newCreator } = body;

    if (!newCreator || typeof newCreator !== 'string') {
      return NextResponse.json(
        { error: 'Имя нового создателя обязательно' },
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

    // Проверяем, что новый создатель в списке участников
    if (!group.participants.includes(newCreator)) {
      return NextResponse.json(
        { error: 'Новый создатель должен быть участником группы' },
        { status: 400 }
      );
    }

    // Передаем права создателя
    await updateGroup(group.id, { createdBy: newCreator });

    return NextResponse.json({
      success: true,
      message: 'Права создателя успешно переданы'
    });

  } catch (error) {
    console.error('Ошибка передачи прав создателя:', error);
    return NextResponse.json(
      { error: 'Внутренняя ошибка сервера' },
      { status: 500 }
    );
  }
}

