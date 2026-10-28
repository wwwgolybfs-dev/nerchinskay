import { createClient } from 'npm:@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
// Проверка подписи Telegram
async function verifyInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('No hash in initData');
  params.delete('hash');
  const dataCheckString = [
    ...params.entries()
  ].sort(([a], [b])=>a.localeCompare(b)).map(([k, v])=>`${k}=${v}`).join('\n');
  const enc = new TextEncoder();
  const secretKey = await crypto.subtle.importKey('raw', enc.encode('WebAppData'), {
    name: 'HMAC',
    hash: 'SHA-256'
  }, false, [
    'sign'
  ]);
  const secret = await crypto.subtle.sign('HMAC', secretKey, enc.encode(botToken));
  const hmacKey = await crypto.subtle.importKey('raw', secret, {
    name: 'HMAC',
    hash: 'SHA-256'
  }, false, [
    'sign'
  ]);
  const signature = await crypto.subtle.sign('HMAC', hmacKey, enc.encode(dataCheckString));
  const calculated = [
    ...new Uint8Array(signature)
  ].map((b)=>b.toString(16).padStart(2, '0')).join('');
  if (calculated !== hash) throw new Error('Invalid initData signature');
  return JSON.parse(params.get('user') || '{}');
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: corsHeaders
  });
  try {
    const { initData, syncCode, action, payload } = await req.json();
    // Инициализируем клиента с правами администратора (service_role)
    const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    let telegramId;
    // --- АВТОРИЗАЦИЯ ---
    if (initData) {
      // Вариант 1: Зашли через Telegram Mini App
      const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
      const tgUser = await verifyInitData(initData, botToken);
      telegramId = tgUser.id;
    } else if (syncCode) {
      // Вариант 2: Зашли через веб-сайт по коду синхронизации
      const { data: profile } = await supabase.from('trek_profiles').select('telegram_id').eq('sync_code', syncCode).single();
      if (!profile) throw new Error('Неверный код синхронизации');
      telegramId = profile.telegram_id;
    } else {
      throw new Error('Требуется авторизация');
    }
    // --- ДЕЙСТВИЯ ---
    if (action === 'get_profile') {
      let { data } = await supabase.from('trek_profiles').select('*').eq('telegram_id', telegramId).maybeSingle();
      if (!data) {
        // Если профиля нет - создаем новый
        const { data: created, error } = await supabase.from('trek_profiles').insert({
          telegram_id: telegramId
        }).select().single();
        if (error) throw error;
        data = created;
      }
      return Response.json({
        profile: data
      }, {
        headers: corsHeaders
      });
    }
    if (action === 'generate_sync_code') {
      // Генерируем случайный код (например, X7F9-A2B4)
      const newCode = Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      const { error } = await supabase.from('trek_profiles').update({
        sync_code: newCode
      }).eq('telegram_id', telegramId);
      if (error) throw error;
      return Response.json({
        sync_code: newCode
      }, {
        headers: corsHeaders
      });
    }
    if (action === 'upsert_profile') {
      const { error } = await supabase.from('trek_profiles').upsert({
        telegram_id: telegramId,
        weight_kg: payload.weight_kg,
        height_cm: payload.height_cm,
        age: payload.age,
        gender: payload.gender,
        goal: payload.goal,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'telegram_id'
      });
      if (error) throw error;
      return Response.json({
        ok: true
      }, {
        headers: corsHeaders
      });
    }
    if (action === 'get_weight_log') {
      const { data, error } = await supabase.from('trek_weight_log').select('*').eq('telegram_id', telegramId).order('logged_at', {
        ascending: false
      }).limit(100);
      if (error) throw error;
      return Response.json({
        entries: data
      }, {
        headers: corsHeaders
      });
    }
    if (action === 'add_weight') {
      const { error } = await supabase.from('trek_weight_log').insert({
        telegram_id: telegramId,
        weight_kg: payload.weight_kg,
        body_fat_percent: payload.body_fat_percent,
        muscle_mass_kg: payload.muscle_mass_kg
      });
      if (error) throw error;
      return Response.json({
        ok: true
      }, {
        headers: corsHeaders
      });
    }
    if (action === 'get_workouts') {
      let query = supabase.from('trek_workouts').select('*').eq('telegram_id', telegramId).order('logged_at', {
        ascending: false
      }).limit(200);
      if (payload?.muscle_group) {
        query = query.eq('muscle_group', payload.muscle_group);
      }
      const { data, error } = await query;
      if (error) throw error;
      return Response.json({
        workouts: data
      }, {
        headers: corsHeaders
      });
    }
    if (action === 'add_workout') {
      const { error } = await supabase.from('trek_workouts').insert({
        telegram_id: telegramId,
        exercise: payload.exercise,
        muscle_group: payload.muscle_group,
        weight_kg: payload.weight_kg,
        reps: payload.reps,
        sets: payload.sets
      });
      if (error) throw error;
      return Response.json({
        ok: true
      }, {
        headers: corsHeaders
      });
    }
    // --- Удаление записей за сегодня ---
    if (action === 'delete_workout') {
      const ids = Array.isArray(payload?.ids) ? payload.ids.filter((id) => typeof id === 'string' && id.length > 0) : [];
      let from = typeof payload?.from === 'string' ? payload.from : null;
      let to = typeof payload?.to === 'string' ? payload.to : null;

      // Запасной вариант для старых клиентов: день по Владивостоку (UTC+10)
      if (!ids.length && !from && payload?.day) {
        const start = new Date(`${payload.day}T00:00:00+10:00`);
        from = start.toISOString();
        to = new Date(start.getTime() + 86400000).toISOString();
      }

      if (!ids.length && (!from || !to)) throw new Error('delete_workout: нужен ids[] или from/to');

      let query = supabase.from('trek_workouts').delete().eq('telegram_id', telegramId);
      query = ids.length ? query.in('id', ids) : query.gte('logged_at', from).lt('logged_at', to);

      // select('id') возвращает именно удалённые строки — по ним считаем результат
      const { data, error } = await query.select('id');
      if (error) throw error;
      return Response.json({ ok: true, deleted: (data || []).length }, { headers: corsHeaders });
    }
    throw new Error(`Unknown action: ${action}`);
  } catch (err) {
    console.error('Error:', err);
    return new Response(JSON.stringify({
      error: err.message
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});