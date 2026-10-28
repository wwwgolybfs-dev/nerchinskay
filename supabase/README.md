# Удаление тренировок: что нужно на стороне Supabase

Кнопки «Удалить» на вкладке **Тренировки** вызывают Edge Function `telegram-api`
с действием `delete_workout`. Если в твоей функции такого действия ещё нет,
клиент покажет ошибку «Не удалось удалить» — тогда добавь обработчик ниже.

> Я не видел исходник функции (она живёт только в Supabase, в репозитории её нет),
> поэтому имена таблицы и колонок взяты по аналогии с `add_workout` / `get_workouts`:
> `workouts`, `user_id`, `logged_at`, `id`. Сверь их со своей функцией перед вставкой.

## Что присылает клиент

```json
// удалить одну запись
{ "action": "delete_workout", "payload": { "ids": ["<uuid>"] } }

// удалить все записи за сегодня
{ "action": "delete_workout", "payload": { "day": "2026-10-28" } }
```

`initData` / `syncCode` клиент добавляет сам, как и в остальных запросах.

## Фрагмент для Edge Function

```ts
// supabase/functions/telegram-api/index.ts
// добавь ветку в тот же switch, где обрабатываются get_workouts / add_workout

case 'delete_workout': {
  const ids: string[] = Array.isArray(payload?.ids) ? payload.ids : [];
  const day: string | undefined = typeof payload?.day === 'string' ? payload.day : undefined;

  if (!ids.length && !day) {
    throw new Error('delete_workout: нужен ids[] или day (YYYY-MM-DD)');
  }

  // userId уже определён выше по initData / syncCode
  let query = supabase.from('workouts').delete().eq('user_id', userId);

  if (ids.length) {
    query = query.in('id', ids);
  } else {
    // день считаем по локальному времени пользователя (UTC+10)
    query = query
      .gte('logged_at', `${day}T00:00:00+10:00`)
      .lt('logged_at', `${day}T23:59:59.999+10:00`);
  }

  const { error } = await query;
  if (error) throw error;

  return { ok: true, deleted: ids.length || 'day' };
}
```

## Как задеплоить

1. Supabase Dashboard → проект `xxauwkymufehmoprmhay` → **Edge Functions** → `telegram-api`.
2. Открыть исходник, вставить ветку `case 'delete_workout'` в `switch (action)`.
3. Deploy.
4. В приложении: Тренировки → «Удалить сегодняшние» (или корзина в строке).
   Должен появиться тост «Удалено: …», а запись — исчезнуть и не вернуться после перезагрузки.

Если в функции уже есть удаление под другим именем — просто поменяй
`'delete_workout'` в `app.js` (одно место, функция `deleteWorkoutRows`) на своё название
и приведи payload к ожидаемому формату.
