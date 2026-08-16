import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';

// 🔴 #341 KILL SWITCH — LEAVE THIS `false` UNTIL SQUARE PAYMENT CONFIRMATIONS
// ARE VERIFIED ARRIVING.
//
// Flip to `true` and the athlete-facing "you still owe us" nudges come back:
// the NotificationBell row and the StoreModal "My Purchases" pay link, both of
// which point at a LIVE Square checkout_url. Measured against the LIVE database
// on 2026-08-16: `store_webhook_events` holds ZERO rows — Square's payment
// webhook has never delivered a single event since the store went up in June
// 2026 — so `paid_at` and `square_payment_id` are NULL on ALL 130 lesson-pack
// purchases and every one of them sits at status='pending' with a live
// checkout_url still attached.
//
// status='pending' therefore means "Square never told us", NOT "the athlete
// owes money". Cordell has confirmed that several of these were in fact paid in
// Square. With this on, an athlete who already paid is shown a red badge
// telling them a payment is due and is handed a one-click link that charges
// their card a second time. That is real money out of a real customer, so this
// stays off — the nudge is worth less than one double charge.
//
// THE ONE CONDITION FOR FLIPPING IT ON: Square payment confirmations verified
// arriving end to end — `store_webhook_events` receiving rows for new payments
// AND `paid_at` populating on the matching store_purchases. Nothing else counts;
// a fixed webhook subscription that has not yet been observed writing those two
// things is not evidence. Until then pending is unfalsifiable and we must not
// bill on it. See also the #305 BOOKING_GATE_ENABLED switch in Schedule.js,
// which is off for the same root cause (the same 130 pending purchases).
//
// When it does go back on, the copy must NOT return to "Payment due" — see the
// wording in NotificationBell.js / StoreModal.js, which states only what we can
// evidence ("Payment not confirmed") and tells an athlete who already paid that
// no action is needed.
export const PAYMENT_DUE_NOTICES_ENABLED = false;

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
  const [packageFlags, setPackageFlags] = useState([]);

  const refresh = useCallback(async () => {
    if (!userId) return;

    // Pending payments assigned to / started by this user (#213). Surfaces a
    // nudge that links straight to Square checkout.
    //
    // #341: gated on PAYMENT_DUE_NOTICES_ENABLED (see the block at the top of
    // this file). While it's off we don't even ASK for these rows: an
    // unrendered checkout_url is still a live "charge me again" URL sitting in
    // the client, and NotificationBell sums this array into its unread badge —
    // so leaving it empty is also what stops the bell reading "1 new" with
    // nothing underneath it. The consumers gate on the flag too; this is the
    // belt to their braces, not a substitute for it.
    if (PAYMENT_DUE_NOTICES_ENABLED) {
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
    } else {
      setPendingPayments([]);
    }

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

      // #305 (Q8): players blocked from booking for lack of a matching
      // package, flagged from ReserveSlotModal. Scoped to coach_id = userId
      // same as pendingSlots above — a coach sees flags for their own
      // slots; an admin sees flags for slots where THEY are the coach on
      // record, not a facility-wide list (matches the existing pattern
      // here rather than inventing a separate admin-only view).
      try {
        const { data: flags } = await supabase
          .from('booking_package_flags')
          .select('id, player_id, slot_id, slot_date, created_at, users:player_id(full_name)')
          .eq('coach_id', userId)
          .order('created_at', { ascending: false })
          .limit(10);
        setPackageFlags(flags || []);
      } catch (e) {
        // #305: booking_package_flags doesn't exist until its migration
        // (20260812_booking_package_flags.sql) runs.
        console.error('Package flags error (migration pending?):', e);
        setPackageFlags([]);
      }
    } else {
      setPendingSlots([]);
      setPackageFlags([]);
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
    const ch5 = supabase.channel(`main-notif-pkg-flags-${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'booking_package_flags' }, refresh).subscribe();
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); supabase.removeChannel(ch3); supabase.removeChannel(ch4); supabase.removeChannel(ch5); };
  }, [refresh, userId]);

  return { unreadMessages, pendingSlots, pendingPayments, packageFlags, refresh };
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
