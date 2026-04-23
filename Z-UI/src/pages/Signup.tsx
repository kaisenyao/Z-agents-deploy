import { useEffect, useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../context/SupabaseAuthContext';
import logo from '../logo.png';

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

interface FormErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

function validateForm(data: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!data.firstName.trim()) errors.firstName = 'First name is required.';
  if (!data.lastName.trim()) errors.lastName = 'Last name is required.';
  if (!data.email.trim()) {
    errors.email = 'Enter an email address.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.email = 'Enter a valid email address.';
  }
  if (!data.password) {
    errors.password = 'Password is required.';
  } else if (data.password.length < 8) {
    errors.password = 'Password must be at least 8 characters.';
  }
  if (!data.confirmPassword) {
    errors.confirmPassword = 'Please confirm your password.';
  } else if (data.password && data.password !== data.confirmPassword) {
    errors.confirmPassword = 'Passwords do not match.';
  }
  return errors;
}

export function Signup() {
  const { loading, session, signUp } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!loading && session) {
      navigate('/dashboard', { replace: true });
    }
  }, [loading, navigate, session]);

  const setField = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const validationErrors = validateForm(form);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setSubmitting(true);
    try {
      const data = await signUp(form.email.toLowerCase().trim(), form.password, {
        data: {
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
        },
      });
      if (data.session) {
        navigate('/dashboard', { replace: true });
        return;
      }
      setSuccess(true);
    } catch (err) {
      setErrors({ email: err instanceof Error ? err.message : 'Something went wrong. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 text-sm focus:outline-none focus:border-slate-500 transition-colors';
  const errorClass = 'mt-1.5 text-sm text-red-400';

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center px-4">
      <img src={logo} alt="Logo" className="h-16 w-auto mb-4" />
      <div className="w-full" style={{ maxWidth: '420px' }}>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8">
          <h1 className="text-xl font-semibold text-slate-100 mb-6">Sign up</h1>

          {success ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-300 leading-relaxed">
                Check your email to confirm your account, then sign in.
              </p>
              <Link
                to="/login"
                className="block text-center w-full mt-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form noValidate onSubmit={handleSubmit} className="space-y-4">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-sm text-slate-400 mb-1.5">First name</label>
                  <input
                    type="text"
                    value={form.firstName}
                    onChange={setField('firstName')}
                    autoFocus
                    className={inputClass}
                  />
                  {errors.firstName && <p className={errorClass}>{errors.firstName}</p>}
                </div>
                <div className="flex-1">
                  <label className="block text-sm text-slate-400 mb-1.5">Last name</label>
                  <input
                    type="text"
                    value={form.lastName}
                    onChange={setField('lastName')}
                    className={inputClass}
                  />
                  {errors.lastName && <p className={errorClass}>{errors.lastName}</p>}
                </div>
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={setField('email')}
                  className={inputClass}
                />
                {errors.email && <p className={errorClass}>{errors.email}</p>}
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Password</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={setField('password')}
                  className={inputClass}
                />
                {errors.password && <p className={errorClass}>{errors.password}</p>}
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Confirm password</label>
                <input
                  type="password"
                  value={form.confirmPassword}
                  onChange={setField('confirmPassword')}
                  className={inputClass}
                />
                {errors.confirmPassword && <p className={errorClass}>{errors.confirmPassword}</p>}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                {submitting ? 'Submitting…' : 'Create account'}
              </button>

              <p className="text-center text-xs text-slate-500">
                Already have an account?{' '}
                <Link
                  to="/login"
                  className="text-slate-300 transition-colors hover:text-slate-100 hover:underline"
                >
                  Sign in
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
