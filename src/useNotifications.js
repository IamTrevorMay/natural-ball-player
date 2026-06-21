import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
async function fetchWorkDmThreadIdsForUser(userId) {
  const [asUserA, asUserB] = await Promise.all([
    supabase.from('work_dm_threads').select('id').eq('user_a_id', userId),
    supabase.from('work_dm_threads').select('id').eq('user_b_id', userId),
  ]);
  if (asUserA.error) throw asUserA.error;
  if (asUserB.error) throw asUserB.error;
  return Array.from(new Set([...(asUserA.data || []).map(row => row.id), ...(asUserB.data || []).map(row => row.id)]));
}

// Counts and details for the Main Portal: unread chat messages + (coach/admin) pending slot reservations.
export function useMainPortalCounts(userId, userRole) {
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [pendingSlots, setPendingSlots] = useState([]);
  const [pendingPayments, setPendingPayments] = useState([]);

  const refresh = useCallback(async () => {
    if (!userId) return;

    // Pending payments assigned to / started by this user (#213). Surfaces a
    // "complete your payment" nudge that links straight to Square checkout.
    try {
      const { data: pays } = await supabase
        .from('store_purchases')
        .select('id, product_name_snapshot, amount_cents, checkout_url, created_at')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .not('checkout_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10);
      setPendingPayments(pays || []);
    } catch (e) { console.error('Pending payments error:', e); }

    try {
      const { data: pRows } = await supabase.from('conversation_participants').select('conversation_id').eq('user_id', userId);
      const convIds = (pRows || []).map(p => p.conversation_id);
      if (convIds.length > 0) {
        const { data: msgs } = await supabase.from('messages').select('id').in('conversation_id', convIds).neq('sender_id', userId);
        const ids = (msgs || []).map(m => m.id);
        if (ids.length > 0) {
          const { data: reads } = await supabase.from('message_reads').select('message_id').eq('user_id', userId).in('message_id', ids);
          const readSet = new Set((reads || []).map(r => r.message_id));
          setUnreadMessages(ids.filter(id => !readSet.has(id)).length);
        } else setUnreadMessages(0);
      } else setUnreadMessages(0);
    } catch (e) { console.error('Main unread error:', e); }

    if (userRole === 'coach' || userRole === 'admin') {
      try {
        const { data: slots } = await supabase.from('training_slots').select('id, slot_date, start_time').eq('coach_id', userId);
        const slotIds = (slots || []).map(s => s.id);
        if (slotIds.length > 0) {
          const { data: pending } = await supabase
            .from('slot_reservations')
            .select('id, slot_id, slot_date, users:player_id(full_name)')
            .in('slot_id', slotIds)
            .eq('status', 'pending');
          const detailed = (pending || []).map(p => ({ ...p, slot: slots.find(s => s.id === p.slot_id) }));
          setPendingSlots(detailed);
        } else setPendingSlots([]);
      } catch (e) { console.error('Pending slots error:', e); }
    } else {
      setPendingSlots([]);
    }
  }, [userId, userRole]);

  useEffect(() => {
    refresh();
    // Scope channel names by userId so two simultaneous mounts of the same
    // hook (portal swap mid-flight, multi-tab) don't collide on a shared
    // channel and trigger double-processing.
    const ch1 = supabase.channel(`main-notif-messages-${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, refresh).subscribe();
    const ch2 = supabase.channel(`main-notif-slots-${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'slot_reservations' }, refresh).subscribe();
    const ch3 = supabase.channel(`main-notif-reads-${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'message_reads' }, refresh).subscribe();
    const ch4 = supabase.channel(`main-notif-payments-${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'store_purchases' }, refresh).subscribe();
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); supabase.removeChannel(ch3); supabase.removeChannel(ch4); };
  }, [refresh, userId]);

  return { unreadMessages, pendingSlots, pendingPayments, refresh };
}

// Counts and details for the Work Portal: unread work messages + (admin) pending hours + pending time off.
export function useWorkPortalCounts(userId, userRole) {
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [pendingHours, setPendingHours] = useState([]);
  const [pendingTimeOff, setPendingTimeOff] = useState([]);

  const refresh = useCallback(async () => {
    if (!userId || (userRole !== 'admin' && userRole !== 'coach')) {
      setUnreadMessages(0);
      setPendingHours([]);
      setPendingTimeOff([]);
      return;
    }

    // Unread work messages
    try {
      const [chRes, dmIds, readsRes] = await Promise.all([
        supabase.from('work_channels').select('id'),
        fetchWorkDmThreadIdsForUser(userId),
        supabase.from('work_message_reads').select('channel_id, dm_thread_id, last_read_at').eq('user_id', userId),
      ]);
      const channelIds = (chRes.data || []).map(c => c.id);
      const readsByChannel = {}, readsByDm = {};
      (readsRes.data || []).forEach(r => {
        if (r.channel_id) readsByChannel[r.channel_id] = r.last_read_at;
        else if (r.dm_thread_id) readsByDm[r.dm_thread_id] = r.last_read_at;
      });
      let count = 0;
      if (channelIds.length > 0) {
        const { data } = await supabase.from('work_messages').select('channel_id, created_at, sender_id').in('channel_id', channelIds);
        (data || []).forEach(m => {
          if (m.sender_id === userId) return;
          const lr = readsByChannel[m.channel_id];
          if (!lr || new Date(m.created_at) > new Date(lr)) count++;
        });
      }
      if (dmIds.length > 0) {
        const { data } = await supabase.from('work_messages').select('dm_thread_id, created_at, sender_id').in('dm_thread_id', dmIds);
        (data || []).forEach(m => {
          if (m.sender_id === userId) return;
          const lr = readsByDm[m.dm_thread_id];
          if (!lr || new Date(m.created_at) > new Date(lr)) count++;
        });
      }
      setUnreadMessages(count);
    } catch (e) { console.error('Work unread error:', e); }

    if (userRole === 'admin') {
      try {
        const [hRes, tRes] = await Promise.all([
          supabase.from('staff_hour_entries').select('id, work_date, hours_decimal, submitter:user_id(full_name)').eq('status', 'pending').order('work_date', { ascending: false }).limit(10),
          supabase.from('staff_time_off_requests').select('id, type, start_date, end_date, submitter:user_id(full_name)').eq('status', 'pending').order('start_date', { ascending: false }).limit(10),
        ]);
        setPendingHours(hRes.data || []);
        setPendingTimeOff(tRes.data || []);
      } catch (e) { console.error('Work pending error:', e); }
    } else {
      setPendingHours([]);
      setPendingTimeOff([]);
    }
  }, [userId, userRole]);

  useEffect(() => {
    refresh();
    const ch1 = supabase.channel(`work-notif-messages-${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'work_messages' }, refresh).subscribe();
    const ch2 = supabase.channel(`work-notif-reads-${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'work_message_reads' }, refresh).subscribe();
    const ch3 = supabase.channel(`work-notif-hours-${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'staff_hour_entries' }, refresh).subscribe();
    const ch4 = supabase.channel(`work-notif-time-off-${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'staff_time_off_requests' }, refresh).subscribe();
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); supabase.removeChannel(ch3); supabase.removeChannel(ch4); };
  }, [refresh, userId]);

  return { unreadMessages, pendingHours, pendingTimeOff, refresh };
}
