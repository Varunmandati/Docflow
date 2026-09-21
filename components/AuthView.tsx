import React, { useEffect, useMemo, useState } from 'react';
import { GoogleAuthProvider, signInWithPopup, signInWithCustomToken } from 'firebase/auth';
import { CloseIcon, SpinnerIcon } from './Icons';
import { firebaseAuth, isFirebaseConfigured } from '../firebase';
import { useToast } from '../hooks/useToast';

type AuthMode = 'login' | 'signup';

interface AuthSuccessPayload {
	name: string;
	email: string;
	avatarUrl?: string;
	provider: 'otp' | 'google';
}

interface AuthViewProps {
	isOpen: boolean;
	onClose: () => void;
	onAuthSuccess: (payload: AuthSuccessPayload) => void;
}

const OTP_REQUEST_ENDPOINTS = ['/v1/auth/otp/request'];
const OTP_VERIFY_ENDPOINTS = ['/v1/auth/otp/verify'];

const getApiBase = () => (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

const GoogleIcon: React.FC = () => (
	<svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
		<path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.6 3.9-5.4 3.9-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.8 0 3 .8 3.7 1.4l2.5-2.4C16.6 3.5 14.5 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12s4.3 9.5 9.5 9.5c5.5 0 9.1-3.8 9.1-9.2 0-.6-.1-1.1-.2-1.6H12z" />
	</svg>
);

const AuthView: React.FC<AuthViewProps> = ({ isOpen, onClose, onAuthSuccess }) => {
	const [mode, setMode] = useState<AuthMode>('login');
	const [name, setName] = useState('');
	const [email, setEmail] = useState('');
	const [otp, setOtp] = useState('');
	const [otpSent, setOtpSent] = useState(false);
	const [otpRequestLoading, setOtpRequestLoading] = useState(false);
	const [otpVerifyLoading, setOtpVerifyLoading] = useState(false);
	const [googleLoading, setGoogleLoading] = useState(false);
	const [error, setError] = useState('');
	const [info, setInfo] = useState('');

	const { addToast } = useToast();
	const apiBase = useMemo(() => getApiBase(), []);

	useEffect(() => {
		if (!isOpen) {
			setOtpSent(false);
			setOtp('');
			setError('');
			setInfo('');
		}
	}, [isOpen]);

	if (!isOpen) {
		return null;
	}

	const normalizeEmail = () => email.trim().toLowerCase();

	const callOtpApi = async (paths: string[], payload: Record<string, string>) => {
		let lastMessage = 'Unable to reach authentication API.';
		// The backend is served under /v1/... (proxied by the dev server). Strip
		// any trailing /api prefix so we never hit the SPA fallback by accident.
		const strippedApiBase = apiBase.replace(/\/api\/?$/, '');

		for (const path of paths) {
			const candidateUrls = [
				`${strippedApiBase}${path}`,
				...(apiBase !== strippedApiBase ? [`${apiBase}${path}`] : []),
			];

			for (const url of candidateUrls) {
				try {
					const response = await fetch(url, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify(payload),
					});

					const data = await response.json().catch(() => ({}));
					const statusFlag =
						typeof data?.success === 'boolean'
							? data.success
							: typeof data?.ok === 'boolean'
								? data.ok
								: false;

					if (response.ok && statusFlag) {
						return data;
					}

					lastMessage =
						data?.message ||
						data?.error ||
						`Authentication failed on ${url}.`;

					// If the backend responded with a real JSON error, stop probing
					// fallback URLs — otherwise the SPA fallback overwrites the
					// genuine backend message and hides the root cause.
					if (typeof data?.message === 'string' || typeof data?.error === 'string') {
						throw new Error(lastMessage);
					}
				} catch (err) {
					if (err instanceof Error && err.message !== 'Unable to connect to the authentication service.') {
						throw err;
					}
					lastMessage = 'Unable to connect to the authentication service.';
				}
			}
		}

		throw new Error(lastMessage);
	};

	const handleSendOtp = async () => {
		setError('');
		setInfo('');

		const cleanEmail = normalizeEmail();

		if (!cleanEmail) {
			setError('Please enter an email address.');
			return;
		}

		if (mode === 'signup' && !name.trim()) {
			setError('Please enter your full name for sign up.');
			return;
		}

		setOtpRequestLoading(true);
		try {
			await callOtpApi(OTP_REQUEST_ENDPOINTS, {
				email: cleanEmail,
				fullName: name.trim(),
				name: name.trim(),
				mode,
				type: mode,
				purpose: mode,
			});
			setOtpSent(true);
			setInfo(`OTP sent to ${cleanEmail}.`);
			addToast('OTP sent successfully.', 'success');
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to send OTP.';
			setError(message);
			addToast(message, 'error');
		} finally {
			setOtpRequestLoading(false);
		}
	};

	const handleVerifyOtp = async () => {
		setError('');
		setInfo('');

		if (!otp.trim()) {
			setError('Please enter the OTP.');
			return;
		}
		const cleanEmail = normalizeEmail();
		const cleanOtp = otp.trim().replace(/\s+/g, '');

		setOtpVerifyLoading(true);
		try {
			const data = await callOtpApi(OTP_VERIFY_ENDPOINTS, {
				email: cleanEmail,
				otp: cleanOtp,
				code: cleanOtp,
				name: name.trim(),
				mode,
				type: mode,
				purpose: mode,
			});

			const user = data?.user || data?.data?.user || {};
			const token = data?.token || data?.data?.token;

			// Persist the backend custom token as well, so the ID token can be
			// re-exchanged later when it expires (localStorage survives reloads).
			if (token) {
				localStorage.setItem('customToken', token);
			}

			let storedToken = token;
			if (token && firebaseAuth) {
				try {
					// The backend mints a Firebase custom token; exchange it for a
					// real ID token (what verifyFirebaseToken expects) and store that.
					const creds = await signInWithCustomToken(firebaseAuth, token);
					storedToken = await creds.user.getIdToken();
				} catch (exchangeErr) {
					console.error('Custom token exchange failed, using raw token:', exchangeErr);
				}
			}

			if (storedToken) {
				localStorage.setItem('authToken', storedToken);
			}

			onAuthSuccess({
				name: user.name || (mode === 'signup' ? name.trim() : email.split('@')[0]),
				email: user.email || cleanEmail,
				avatarUrl: user.avatarUrl,
				provider: 'otp',
			});
			addToast(mode === 'signup' ? 'Account created successfully.' : 'Logged in successfully.', 'success');
		} catch (err) {
			const message = err instanceof Error ? err.message : 'OTP verification failed.';
			setError(message);
			addToast(message, 'error');
		} finally {
			setOtpVerifyLoading(false);
		}
	};

	const handleGoogleAuth = async () => {
		setError('');
		setInfo('');

		if (!isFirebaseConfigured || !firebaseAuth) {
			setError('Firebase Google auth is not configured. Check VITE_FIREBASE_* values in .env.local.');
			return;
		}

		setGoogleLoading(true);
		try {
			const provider = new GoogleAuthProvider();
			provider.setCustomParameters({ prompt: 'select_account' });
			const result = await signInWithPopup(firebaseAuth, provider);

			// Persist the Firebase ID token so protected /v1/* API calls
			// (authFetch) send a valid Authorization header.
			const idToken = await result.user.getIdToken();
			if (idToken) {
				localStorage.setItem('authToken', idToken);
			}

			onAuthSuccess({
				name: result.user.displayName || result.user.email?.split('@')[0] || 'User',
				email: result.user.email || '',
				avatarUrl: result.user.photoURL || undefined,
				provider: 'google',
			});
			addToast('Google authentication successful.', 'success');
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Google authentication failed.';
			setError(message);
			addToast('Google authentication failed.', 'error');
		} finally {
			setGoogleLoading(false);
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
			<div className="w-full max-w-md panel-card p-8 relative animate-in-item elevation-5 overflow-hidden">
				<div className="absolute inset-x-0 top-0 h-1" style={{ background: 'linear-gradient(90deg, transparent, var(--brand-accent), transparent)' }} />
				<button
					onClick={onClose}
					className="absolute top-4 right-4 p-2 rounded-full hover:bg-[var(--well)] transition-colors"
					aria-label="Close auth dialog"
				>
					<CloseIcon className="w-5 h-5 text-[var(--text-secondary)]" />
				</button>

				<div className="flex items-center gap-3 mb-5">
					<div className="w-11 h-11 rounded-2xl well flex items-center justify-center">
						<span className="caption-mono" style={{ color: 'var(--brand-accent)', fontWeight: 600 }}>DF</span>
					</div>
					<div>
						<h2 className="display-sm text-[var(--text-primary)]">Welcome</h2>
						<p className="caption-text" style={{ color: 'var(--text-tertiary)' }}>Sign in to sync files across sessions</p>
					</div>
				</div>

				<div className="segmented-control mb-5">
					<button
						onClick={() => {
							setMode('login');
							setOtpSent(false);
							setOtp('');
							setError('');
							setInfo('');
						}}
						className={`capitalize ${mode === 'login' ? 'active' : ''}`}
					>
						Login
					</button>
					<button
						onClick={() => {
							setMode('signup');
							setOtpSent(false);
							setOtp('');
							setError('');
							setInfo('');
						}}
						className={`capitalize ${mode === 'signup' ? 'active' : ''}`}
					>
						Sign up
					</button>
				</div>

				<div className="space-y-3">
					{mode === 'signup' && (
						<input
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Full name"
							className="w-full vercel-input"
						/>
					)}
					<input
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						placeholder="Email"
						className="w-full vercel-input"
					/>

					{!otpSent && (
						<button
							onClick={handleSendOtp}
							disabled={otpRequestLoading}
							className="w-full glowing-btn pill-btn py-2.5 font-medium text-sm disabled:opacity-60 disabled:cursor-not-allowed"
						>
							{otpRequestLoading ? (
								<span className="flex items-center justify-center gap-2">
									<SpinnerIcon className="w-4 h-4" /> Sending OTP...
								</span>
							) : (
								'Send OTP'
							)}
						</button>
					)}

					{otpSent && (
						<>
							<input
								type="text"
								value={otp}
								onChange={(e) => setOtp(e.target.value)}
								placeholder="Enter OTP"
								className="w-full vercel-input"
							/>
							<button
								onClick={handleVerifyOtp}
								disabled={otpVerifyLoading}
								className="w-full glowing-btn pill-btn py-2.5 font-medium text-sm disabled:opacity-60 disabled:cursor-not-allowed"
							>
								{otpVerifyLoading ? (
									<span className="flex items-center justify-center gap-2">
										<SpinnerIcon className="w-4 h-4" /> Verifying...
									</span>
								) : (
									mode === 'signup' ? 'Create Account' : 'Login'
								)}
							</button>
							<button
								onClick={handleSendOtp}
								disabled={otpRequestLoading}
								className="w-full text-sm font-semibold text-[var(--primary-color)] hover:underline"
							>
								Resend OTP
							</button>
						</>
					)}
				</div>

				<div className="my-4 flex items-center gap-3">
					<div className="h-px flex-1 bg-[var(--border-color)]" />
					<span className="text-xs font-medium text-[var(--text-tertiary)]">OR</span>
					<div className="h-px flex-1 bg-[var(--border-color)]" />
				</div>

				<button
					onClick={handleGoogleAuth}
					disabled={googleLoading}
					className="w-full outline-btn py-2.5 font-medium text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
				>
					{googleLoading ? (
						<span className="flex items-center justify-center gap-2">
							<SpinnerIcon className="w-4 h-4" /> Connecting Google...
						</span>
					) : (
						<span className="flex items-center justify-center gap-2">
							<GoogleIcon /> Continue with Google
						</span>
					)}
				</button>

				{info && <p className="mt-3 text-sm text-[var(--success-color)]">{info}</p>}
				{error && <p className="mt-3 text-sm text-[var(--danger-color)]">{error}</p>}
			</div>
		</div>
	);
};

export default AuthView;
