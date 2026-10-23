-- ============================================================================
-- OUTPOST Smart Student Accommodation Platform
-- Migration: 20261020000002_row_level_security.sql
-- Description: Complete Row Level Security Policies and Authorization Helpers
-- ============================================================================

-- 1. Helper Functions (SECURITY DEFINER with strict search_path)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND account_status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_landlord()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'landlord'
      AND account_status != 'suspended'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_student()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'student'
      AND account_status != 'suspended'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_group_admin(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id
      AND user_id = auth.uid()
      AND role = 'admin'
  ) OR EXISTS (
    SELECT 1 FROM public.accommodation_groups
    WHERE id = p_group_id
      AND leader_id = auth.uid()
  ) OR public.is_admin();
$$;

CREATE OR REPLACE FUNCTION public.is_conversation_participant(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = p_conversation_id
      AND user_id = auth.uid()
  ) OR public.is_admin();
$$;

-- Explicitly revoke execute privileges from PUBLIC and grant to authenticated
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_landlord() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_student() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_group_admin(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_conversation_participant(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_landlord() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_student() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_group_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_participant(UUID) TO authenticated;

-- ============================================================================
-- 2. Enable RLS on ALL Public Tables
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landlord_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_verification_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landlord_verification_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roommate_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roommate_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accommodation_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3. RLS Policies
-- ============================================================================

-- 3.1 Profiles
CREATE POLICY "Profiles are readable by authenticated users"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = id
    AND role = 'student'
    AND account_status IN ('email_unverified', 'active')
    AND is_verified = false
  );

CREATE POLICY "Users can update own editable profile fields"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
    AND account_status = (SELECT p.account_status FROM public.profiles p WHERE p.id = auth.uid())
    AND is_verified = (SELECT p.is_verified FROM public.profiles p WHERE p.id = auth.uid())
  );

CREATE POLICY "Admins have full access to profiles"
  ON public.profiles FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 3.2 Student Profiles
CREATE POLICY "Student profiles readable by authenticated users"
  ON public.student_profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Students can insert own profile"
  ON public.student_profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND is_profile_verified = false
  );

CREATE POLICY "Students can update own editable fields"
  ON public.student_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND is_profile_verified = (SELECT sp.is_profile_verified FROM public.student_profiles sp WHERE sp.user_id = auth.uid())
  );

CREATE POLICY "Admins have full access to student profiles"
  ON public.student_profiles FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 3.3 Landlord Profiles
CREATE POLICY "Landlord profiles readable by authenticated users"
  ON public.landlord_profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Landlords can insert own profile"
  ON public.landlord_profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND verification_status IN ('not_started', 'pending')
  );

CREATE POLICY "Landlords can update own editable fields"
  ON public.landlord_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND verification_status = (SELECT lp.verification_status FROM public.landlord_profiles lp WHERE lp.user_id = auth.uid())
  );

CREATE POLICY "Admins have full access to landlord profiles"
  ON public.landlord_profiles FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 3.4 Student Verification Documents
CREATE POLICY "Students read own verification documents"
  ON public.student_verification_documents FOR SELECT
  TO authenticated
  USING (auth.uid() = student_id OR public.is_admin());

CREATE POLICY "Students insert own verification document"
  ON public.student_verification_documents FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = student_id
    AND status = 'pending'
  );

CREATE POLICY "Admins update verification documents"
  ON public.student_verification_documents FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Students or admins delete pending verification documents"
  ON public.student_verification_documents FOR DELETE
  TO authenticated
  USING ((auth.uid() = student_id AND status = 'pending') OR public.is_admin());

-- 3.5 Landlord Verification Submissions
CREATE POLICY "Landlords read own verification submissions"
  ON public.landlord_verification_submissions FOR SELECT
  TO authenticated
  USING (auth.uid() = landlord_id OR public.is_admin());

CREATE POLICY "Landlords insert own verification submission"
  ON public.landlord_verification_submissions FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = landlord_id
    AND status = 'pending'
  );

CREATE POLICY "Admins update landlord verification submissions"
  ON public.landlord_verification_submissions FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Landlords or admins delete pending submissions"
  ON public.landlord_verification_submissions FOR DELETE
  TO authenticated
  USING ((auth.uid() = landlord_id AND status = 'pending') OR public.is_admin());

-- 3.6 Properties
CREATE POLICY "Public reads approved and published properties"
  ON public.properties FOR SELECT
  TO authenticated, anon
  USING (
    (approval_status = 'approved' AND is_published = true)
    OR (auth.uid() = landlord_id)
    OR public.is_admin()
  );

CREATE POLICY "Landlords insert draft properties"
  ON public.properties FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = landlord_id
    AND public.is_landlord()
    AND approval_status = 'draft'
    AND is_published = false
  );

CREATE POLICY "Landlords update own non-approved properties"
  ON public.properties FOR UPDATE
  TO authenticated
  USING (auth.uid() = landlord_id OR public.is_admin())
  WITH CHECK (
    (auth.uid() = landlord_id AND approval_status IN ('draft', 'pending', 'rejected') AND is_published = false)
    OR public.is_admin()
  );

CREATE POLICY "Landlords delete own draft properties"
  ON public.properties FOR DELETE
  TO authenticated
  USING (
    (auth.uid() = landlord_id AND approval_status IN ('draft', 'rejected'))
    OR public.is_admin()
  );

-- 3.7 Units
CREATE POLICY "Units visible if property is visible"
  ON public.units FOR SELECT
  TO authenticated, anon
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = units.property_id
        AND (
          (p.approval_status = 'approved' AND p.is_published = true)
          OR p.landlord_id = auth.uid()
          OR public.is_admin()
        )
    )
  );

CREATE POLICY "Landlords manage units for own properties"
  ON public.units FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = units.property_id
        AND (p.landlord_id = auth.uid() OR public.is_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = units.property_id
        AND (p.landlord_id = auth.uid() OR public.is_admin())
    )
  );

-- 3.8 Property Locations (Privacy release)
CREATE POLICY "Public coordinates visible only after admin verification"
  ON public.property_locations FOR SELECT
  TO authenticated, anon
  USING (
    (
      verification_status = 'approved'
      AND EXISTS (
        SELECT 1 FROM public.properties p
        WHERE p.id = property_locations.property_id
          AND p.approval_status = 'approved'
          AND p.is_published = true
      )
    )
    OR submitted_by = auth.uid()
    OR public.is_admin()
  );

CREATE POLICY "Landlords submit location for own properties"
  ON public.property_locations FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = submitted_by
    AND public.is_landlord()
    AND verification_status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_locations.property_id
        AND p.landlord_id = auth.uid()
    )
  );

CREATE POLICY "Landlords update pending location"
  ON public.property_locations FOR UPDATE
  TO authenticated
  USING (
    (submitted_by = auth.uid() AND verification_status IN ('pending', 'rejected'))
    OR public.is_admin()
  )
  WITH CHECK (
    (submitted_by = auth.uid() AND verification_status = 'pending')
    OR public.is_admin()
  );

CREATE POLICY "Landlords delete pending location"
  ON public.property_locations FOR DELETE
  TO authenticated
  USING (
    (submitted_by = auth.uid() AND verification_status != 'approved')
    OR public.is_admin()
  );

-- 3.9 Roommate Preferences
CREATE POLICY "Roommate preferences readable by authenticated users"
  ON public.roommate_preferences FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Students manage own roommate preferences"
  ON public.roommate_preferences FOR ALL
  TO authenticated
  USING (student_id = auth.uid() OR public.is_admin())
  WITH CHECK (student_id = auth.uid() OR public.is_admin());

-- 3.10 Roommate Requests
CREATE POLICY "Participants read roommate requests"
  ON public.roommate_requests FOR SELECT
  TO authenticated
  USING (sender_id = auth.uid() OR receiver_id = auth.uid() OR public.is_admin());

CREATE POLICY "Students create roommate requests"
  ON public.roommate_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_student()
    AND status = 'pending'
  );

CREATE POLICY "Receiver responds or sender cancels roommate request"
  ON public.roommate_requests FOR UPDATE
  TO authenticated
  USING (sender_id = auth.uid() OR receiver_id = auth.uid() OR public.is_admin())
  WITH CHECK (
    (receiver_id = auth.uid() AND status IN ('accepted', 'rejected'))
    OR (sender_id = auth.uid() AND status = 'cancelled')
    OR public.is_admin()
  );

-- 3.11 Accommodation Groups
CREATE POLICY "Active groups readable by authenticated users"
  ON public.accommodation_groups FOR SELECT
  TO authenticated
  USING (is_active = true OR leader_id = auth.uid() OR public.is_admin());

CREATE POLICY "Students create groups as leader"
  ON public.accommodation_groups FOR INSERT
  TO authenticated
  WITH CHECK (leader_id = auth.uid() AND public.is_student());

CREATE POLICY "Group admins or leader update group"
  ON public.accommodation_groups FOR UPDATE
  TO authenticated
  USING (public.is_group_admin(id))
  WITH CHECK (public.is_group_admin(id));

CREATE POLICY "Group leader or admin delete group"
  ON public.accommodation_groups FOR DELETE
  TO authenticated
  USING (leader_id = auth.uid() OR public.is_admin());

-- 3.12 Group Members
CREATE POLICY "Group members visible to authenticated users"
  ON public.group_members FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Group admin or user self-join manages membership"
  ON public.group_members FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_group_admin(group_id)
    OR (user_id = auth.uid() AND role = 'member')
  );

CREATE POLICY "Group admin updates member role"
  ON public.group_members FOR UPDATE
  TO authenticated
  USING (public.is_group_admin(group_id))
  WITH CHECK (public.is_group_admin(group_id));

CREATE POLICY "Member leaves or admin removes member"
  ON public.group_members FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_group_admin(group_id)
  );

-- 3.13 Group Join Requests
CREATE POLICY "Group join requests readable by applicant or group admins"
  ON public.group_join_requests FOR SELECT
  TO authenticated
  USING (student_id = auth.uid() OR public.is_group_admin(group_id));

CREATE POLICY "Students submit group join request"
  ON public.group_join_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    student_id = auth.uid()
    AND status = 'pending'
  );

CREATE POLICY "Admins respond or student cancels join request"
  ON public.group_join_requests FOR UPDATE
  TO authenticated
  USING (student_id = auth.uid() OR public.is_group_admin(group_id))
  WITH CHECK (
    (public.is_group_admin(group_id) AND status IN ('accepted', 'rejected'))
    OR (student_id = auth.uid() AND status = 'cancelled')
  );

-- 3.14 Group Invitations
CREATE POLICY "Invitations readable by recipient or group admins"
  ON public.group_invitations FOR SELECT
  TO authenticated
  USING (student_id = auth.uid() OR public.is_group_admin(group_id));

CREATE POLICY "Group admins create invitations"
  ON public.group_invitations FOR INSERT
  TO authenticated
  WITH CHECK (public.is_group_admin(group_id) AND invited_by = auth.uid());

CREATE POLICY "Recipient responds to invitation"
  ON public.group_invitations FOR UPDATE
  TO authenticated
  USING (student_id = auth.uid() OR public.is_group_admin(group_id))
  WITH CHECK (
    (student_id = auth.uid() AND status IN ('accepted', 'rejected'))
    OR (public.is_group_admin(group_id) AND status = 'cancelled')
  );

-- 3.15 Reservations
CREATE POLICY "Student, landlord, or admin read reservations"
  ON public.reservations FOR SELECT
  TO authenticated
  USING (student_id = auth.uid() OR landlord_id = auth.uid() OR public.is_admin());

CREATE POLICY "Student creates pending reservation"
  ON public.reservations FOR INSERT
  TO authenticated
  WITH CHECK (
    student_id = auth.uid()
    AND public.is_student()
    AND status = 'pending_payment'
    AND hold_expires_at > now()
    AND hold_expires_at <= now() + interval '7 days'
    AND EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = reservations.property_id
        AND p.approval_status = 'approved'
        AND p.is_published = true
        AND p.landlord_id = reservations.landlord_id
    )
  );

CREATE POLICY "Student cancels own pending reservation or admin manages"
  ON public.reservations FOR UPDATE
  TO authenticated
  USING (
    (student_id = auth.uid() AND status = 'pending_payment')
    OR public.is_admin()
  )
  WITH CHECK (
    (student_id = auth.uid() AND status = 'cancelled')
    OR public.is_admin()
  );

-- 3.16 Invoices
CREATE POLICY "Student, landlord, or admin read invoices"
  ON public.invoices FOR SELECT
  TO authenticated
  USING (student_id = auth.uid() OR landlord_id = auth.uid() OR public.is_admin());

CREATE POLICY "Invoices inserted by system or admin"
  ON public.invoices FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Invoices updated by admin only"
  ON public.invoices FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 3.17 Payment Receipts
CREATE POLICY "Student, landlord, or admin read receipts"
  ON public.payment_receipts FOR SELECT
  TO authenticated
  USING (student_id = auth.uid() OR landlord_id = auth.uid() OR public.is_admin());

CREATE POLICY "Student submits payment receipt for own reservation"
  ON public.payment_receipts FOR INSERT
  TO authenticated
  WITH CHECK (
    student_id = auth.uid()
    AND status = 'pending_review'
    AND EXISTS (
      SELECT 1 FROM public.reservations r
      WHERE r.id = payment_receipts.reservation_id
        AND r.student_id = auth.uid()
        AND r.landlord_id = payment_receipts.landlord_id
        AND r.status IN ('pending_payment', 'payment_submitted')
    )
  );

CREATE POLICY "Landlord reviews receipt for own property"
  ON public.payment_receipts FOR UPDATE
  TO authenticated
  USING (landlord_id = auth.uid() OR public.is_admin())
  WITH CHECK (
    (landlord_id = auth.uid() AND status IN ('approved', 'rejected') AND (status != 'rejected' OR length(rejection_reason) > 0))
    OR public.is_admin()
  );

-- 3.18 Conversations
CREATE POLICY "Participants read conversations"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (public.is_conversation_participant(id));

CREATE POLICY "Authenticated users create conversations"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Participants update conversation meta"
  ON public.conversations FOR UPDATE
  TO authenticated
  USING (public.is_conversation_participant(id))
  WITH CHECK (public.is_conversation_participant(id));

-- 3.19 Conversation Participants
CREATE POLICY "Participants view conversation participant list"
  ON public.conversation_participants FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_conversation_participant(conversation_id)
  );

CREATE POLICY "Users add participants"
  ON public.conversation_participants FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_conversation_participant(conversation_id)
  );

CREATE POLICY "Participants update own read status"
  ON public.conversation_participants FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Participants leave conversation"
  ON public.conversation_participants FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- 3.20 Messages
CREATE POLICY "Participants read conversation messages"
  ON public.messages FOR SELECT
  TO authenticated
  USING (public.is_conversation_participant(conversation_id));

CREATE POLICY "Participants send messages"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_conversation_participant(conversation_id)
  );

CREATE POLICY "Sender edits message within 15 minutes"
  ON public.messages FOR UPDATE
  TO authenticated
  USING (
    sender_id = auth.uid()
    AND created_at >= (now() - interval '15 minutes')
  )
  WITH CHECK (
    sender_id = auth.uid()
    AND is_edited = true
  );

CREATE POLICY "Admins delete messages"
  ON public.messages FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- 3.21 Notifications
CREATE POLICY "Users read own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users update own notification read state"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users delete own notifications"
  ON public.notifications FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- 3.22 Audit Logs (Append-Only)
CREATE POLICY "Admins read audit logs"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "System inserts audit logs"
  ON public.audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    (public.is_admin() AND (actor_id = auth.uid() OR actor_id IS NULL))
    OR
    (
      actor_id = auth.uid()
      AND action NOT LIKE 'admin_%'
      AND action NOT LIKE 'ADMIN_%'
      AND action NOT LIKE 'system_%'
      AND action NOT LIKE 'SYSTEM_%'
      AND action NOT IN (
        'approve_receipt', 'reject_receipt', 'review_receipt', 'REVIEW_RECEIPT',
        'verify_landlord', 'verify_student', 'verify_location',
        'suspend_user', 'promote_admin', 'expire_reservation', 'EXPIRE_RESERVATION',
        'create_invoice', 'update_invoice'
      )
    )
  );

-- No UPDATE or DELETE policies on public.audit_logs -> strictly immutable!
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM anon;

-- 3.23 Platform Settings
CREATE POLICY "Platform settings readable by everyone"
  ON public.platform_settings FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "Admins manage platform settings"
  ON public.platform_settings FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

