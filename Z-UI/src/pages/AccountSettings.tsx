import { useEffect, useRef, useState } from 'react';
import { Camera, Lock } from 'lucide-react';
import { useProfile } from '../context/ProfileContext';
import { useAuth } from '../context/SupabaseAuthContext';
import { supabase } from '../lib/supabase';

export function AccountSettings() {
  const { profile, setProfile, saveProfile } = useProfile();
  const { user } = useAuth();
  const [editEmail, setEditEmail] = useState(user?.email ?? '');
  const [profileError, setProfileError] = useState('');
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', newPw: '', confirm: '' });
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    const metadata = user.user_metadata || {};
    setProfile(prev => ({
      ...prev,
      firstName: typeof metadata.first_name === 'string' ? metadata.first_name : prev.firstName,
      lastName:  typeof metadata.last_name === 'string' ? metadata.last_name : prev.lastName,
    }));
    if (user.email) setEditEmail(user.email);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setProfile({ ...profile, avatarUrl: ev.target?.result as string });
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async () => {
    setProfileError('');

    // Frontend validation
    const trimmedFirst = profile.firstName.trim();
    const trimmedLast  = profile.lastName.trim();
    const trimmedEmail = editEmail.trim();

    if (!trimmedFirst) {
      setProfileError('First name is required.');
      return;
    }
    if (!trimmedEmail) {
      setProfileError('Email is required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setProfileError('Invalid email address.');
      return;
    }
    if (!user) {
      setProfileError('Session expired. Please log in again.');
      return;
    }

    setProfileSubmitting(true);
    try {
      const { data, error } = await supabase.auth.updateUser({
        email: trimmedEmail,
        data: {
          first_name: trimmedFirst,
          last_name: trimmedLast,
        },
      });
      if (error) {
        setProfileError(error.message || 'Failed to save profile.');
        return;
      }
      saveProfile({ ...profile, firstName: trimmedFirst, lastName: trimmedLast });
      setEditEmail(data.user.email || trimmedEmail);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch {
      setProfileError('Network error. Please try again.');
    } finally {
      setProfileSubmitting(false);
    }
  };

  const handleUpdatePassword = async () => {
    setPasswordError('');

    if (!passwords.current) {
      setPasswordError('Please enter your current password.');
      return;
    }
    if (!passwords.newPw) {
      setPasswordError('Please enter a new password.');
      return;
    }
    if (!passwords.confirm) {
      setPasswordError('Please confirm your password.');
      return;
    }
    if (passwords.newPw !== passwords.confirm) {
      setPasswordError('New passwords do not match.');
      return;
    }
    if (passwords.newPw.length < 8) {
      setPasswordError('Password must be at least 8 characters.');
      return;
    }
    if (!user?.email) return;

    setPasswordSubmitting(true);
    try {
      const current = await supabase.auth.signInWithPassword({
        email: user.email,
        password: passwords.current,
      });
      if (current.error) {
        setPasswordError('Current password is incorrect.');
        return;
      }

      const { error } = await supabase.auth.updateUser({
        password: passwords.newPw,
      });
      if (error) {
        setPasswordError(error.message || 'Something went wrong.');
        return;
      }
      setPasswordSuccess(true);
      setPasswords({ current: '', newPw: '', confirm: '' });
      setTimeout(() => {
        setPasswordSuccess(false);
        setShowPasswordForm(false);
      }, 2000);
    } catch {
      setPasswordError('Something went wrong. Please try again.');
    } finally {
      setPasswordSubmitting(false);
    }
  };

  return (
    <div className="text-slate-100">
      <div className="py-2">
        <h1 className="text-2xl font-bold text-slate-100 mb-6">Settings</h1>


        {/* Profile Section */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-6">
          <h2 className="text-base font-semibold text-slate-100 mb-4">Profile</h2>

          {/* Avatar */}
          <div className="flex items-center gap-4 mb-6">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handlePhotoChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="relative w-16 h-16 rounded-full bg-slate-800 border border-slate-700 overflow-hidden flex items-center justify-center flex-shrink-0 group cursor-pointer"
            >
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <Camera className="w-6 h-6 text-slate-600" />
              )}
            </button>
          </div>

          {/* Profile Fields */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1.5">First Name</label>
              <input
                type="text"
                value={profile.firstName}
                onChange={(e) => setProfile({ ...profile, firstName: e.target.value })}
                className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 text-sm focus:outline-none focus:border-slate-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1.5">Last Name</label>
              <input
                type="text"
                value={profile.lastName}
                onChange={(e) => setProfile({ ...profile, lastName: e.target.value })}
                className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 text-sm focus:outline-none focus:border-slate-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1.5">Email</label>
              <input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 text-sm focus:outline-none focus:border-slate-500 transition-colors"
              />
            </div>
          </div>

          {profileError && (
            <p className="text-sm text-red-400 mt-4">{profileError}</p>
          )}

          <div className="flex justify-end mt-4">
            <button
              onClick={handleSaveProfile}
              disabled={profileSubmitting}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              {profileSubmitting ? 'Saving…' : saveSuccess ? 'Saved' : 'Save Profile'}
            </button>
          </div>
        </div>

        {/* Security Section */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-100 mb-4">Security</h2>

            </div>
            {!showPasswordForm && (
              <button
                onClick={() => setShowPasswordForm(true)}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm text-slate-300 transition-colors"
              >
                <Lock className="w-4 h-4" />
                Change Password
              </button>
            )}
          </div>

          {showPasswordForm && (
            <div className="mt-8 space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Current Password</label>
                <input
                  type="password"
                  value={passwords.current}
                  onChange={(e) => setPasswords((p) => ({ ...p, current: e.target.value }))}
                  className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 text-sm focus:outline-none focus:border-slate-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">New Password</label>
                <input
                  type="password"
                  value={passwords.newPw}
                  onChange={(e) => setPasswords((p) => ({ ...p, newPw: e.target.value }))}
                  className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 text-sm focus:outline-none focus:border-slate-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Confirm Password</label>
                <input
                  type="password"
                  value={passwords.confirm}
                  onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))}
                  className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 text-sm focus:outline-none focus:border-slate-500 transition-colors"
                />
              </div>

              {passwordError && (
                <p className="text-sm text-red-400">{passwordError}</p>
              )}
              {passwordSuccess && (
                <p className="text-sm text-emerald-400">Password updated successfully.</p>
              )}

              <div className="flex justify-end gap-3 pt-1">
                <button
                  onClick={() => {
                    setShowPasswordForm(false);
                    setPasswords({ current: '', newPw: '', confirm: '' });
                    setPasswordError('');
                  }}
                  className="px-4 py-2.5 text-sm text-slate-400 hover:text-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdatePassword}
                  disabled={passwordSubmitting}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {passwordSubmitting ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
