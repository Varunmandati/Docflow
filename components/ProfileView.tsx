import React, { useState, useRef, useEffect } from 'react';
import Cropper from 'react-easy-crop';
import { ProfileTranslation } from '../translations';
import { UserProfile } from '../types';
import { CheckIcon } from './Icons';
import { getCroppedImg } from '../services/profileImageService';
import { useToast } from '../hooks/useToast';

interface ProfileViewProps {
    t: ProfileTranslation;
    userProfile: UserProfile;
    onSave: (newProfile: UserProfile) => void;
}

// Sub-component moved outside to prevent re-creation on every render
const InputField: React.FC<{ label: string; value: string; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void; type?: string; disabled?: boolean; isGlassEffect: boolean }> = ({ label, value, onChange, type = 'text', disabled = false, isGlassEffect }) => {
    const inputBgClass = 'bg-[var(--background-card)]';

    return (
        <div>
            <label className="block caption-text font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</label>
            <input
                type={type}
                value={value}
                onChange={onChange}
                disabled={disabled}
                className={`w-full vercel-input ${disabled ? 'opacity-60' : ''}`}
            />
        </div>
    );
};

const ProfileView: React.FC<ProfileViewProps> = ({ t, userProfile, onSave }) => {
    const isGlassEffect = document.documentElement.classList.contains('dark');
    const { addToast } = useToast();
    
    const [name, setName] = useState(userProfile.name);
    const [email, setEmail] = useState(userProfile.email);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
    const [pictureDimensions, setPictureDimensions] = useState({ width: 0, height: 0 });
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success'>('idle');

    // Email change states
    const [showEmailChangeModal, setShowEmailChangeModal] = useState(false);
    const [newEmail, setNewEmail] = useState('');
    const [emailStep, setEmailStep] = useState<'input' | 'otp'>('input');
    const [emailOtp, setEmailOtp] = useState('');
    const [emailLoading, setEmailLoading] = useState(false);

    // Picture resizing states
    const [showPictureResizer, setShowPictureResizer] = useState(false);
    const [pictureFile, setPictureFile] = useState<File | null>(null);
    const [imageSrc, setImageSrc] = useState<string | null>(null);
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);

    const formatBytes = (bytes?: number) => {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    useEffect(() => {
        setName(userProfile.name);
        setEmail(userProfile.email);
        setAvatarPreview(userProfile.avatarUrl || null);
    }, [userProfile]);

    const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setPictureFile(file);
            setImageSrc(URL.createObjectURL(file));
            setZoom(1);
            setCrop({ x: 0, y: 0 });
            setShowPictureResizer(true);
        }
    };

    const onCropComplete = (croppedArea: any, croppedAreaPixels: any) => {
        setCroppedAreaPixels(croppedAreaPixels);
    };

    const handleResizeAndCrop = async () => {
        if (!imageSrc || !croppedAreaPixels) return;

        try {
            const cropped = await getCroppedImg(imageSrc, croppedAreaPixels);
            setAvatarPreview(cropped);
            setShowPictureResizer(false);
            setPictureFile(null);
            setImageSrc(null);
            addToast('Picture resized successfully', 'success');
        } catch (error) {
            addToast('Failed to resize picture', 'error');
        }
    };

    const handleRequestEmailOtp = async () => {
        if (!newEmail || newEmail === email) {
            addToast('Please enter a different email', 'error');
            return;
        }

        setEmailLoading(true);
        try {
            const token = localStorage.getItem('authToken');
            const response = await fetch('/v1/profile/change-email/request-otp', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : '',
                },
                body: JSON.stringify({ newEmail }),
            });

            const data = await response.json();
            if (data.success) {
                setEmailStep('otp');
                addToast('OTP sent to your new email', 'success');
            } else {
                addToast(data.message || 'Failed to send OTP', 'error');
            }
        } catch (error) {
            addToast('Network error while sending OTP', 'error');
        } finally {
            setEmailLoading(false);
        }
    };

    const handleVerifyEmailOtp = async () => {
        if (!emailOtp || emailOtp.length < 4) {
            addToast('Please enter a valid OTP', 'error');
            return;
        }

        setEmailLoading(true);
        try {
            const token = localStorage.getItem('authToken');
            const response = await fetch('/v1/profile/change-email/verify-otp', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : '',
                },
                body: JSON.stringify({ newEmail, otp: emailOtp }),
            });

            const data = await response.json();
            if (data.success) {
                setEmail(newEmail);
                setShowEmailChangeModal(false);
                setEmailStep('input');
                setNewEmail('');
                setEmailOtp('');
                addToast('Email changed successfully', 'success');
            } else {
                console.error('Verify OTP failed. Backend returned:', data);
                addToast(data.message || 'Invalid OTP', 'error');
            }
        } catch (error) {
            addToast('Network error while verifying OTP', 'error');
        } finally {
            setEmailLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            const token = localStorage.getItem('authToken');
            // If avatar changed, upload it
            if (avatarPreview && avatarPreview !== userProfile.avatarUrl) {
                const response = await fetch('/v1/profile/upload-picture', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': token ? `Bearer ${token}` : '',
                    },
                    body: JSON.stringify({ pictureDataUrl: avatarPreview }),
                });

                if (!response.ok) {
                    addToast('Failed to upload picture', 'error');
                    return;
                }
            }

            // Update profile
            onSave({
                name,
                email,
                avatarUrl: avatarPreview || userProfile.avatarUrl,
            });

            setSaveStatus('success');
            addToast('Profile saved successfully', 'success');
            setTimeout(() => {
                setSaveStatus('idle');
            }, 2000);
        } catch (error) {
            addToast('Failed to save profile', 'error');
        }
    };

    return (
        <div className="p-4 sm:p-8 w-full">
            <header className="mb-8">
                <div className="flex items-center gap-3">
                    <h1 className="display-md" style={{ color: 'var(--text-primary)' }}>{t.title}</h1>
                </div>
                <p className="body-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Manage your personal profile and storage</p>
            </header>

            <div className="relative max-w-4xl mx-auto rounded-xl border border-[var(--border-color)] p-8 bg-[var(--background-card)] elevation-4">
                <div className="card-sheen"></div>
                <div className="flex flex-col md:flex-row items-center gap-8 md:gap-12">
                    {/* Avatar */}
                    <div className="flex-shrink-0 text-center">
                        <label className="block caption-text font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>{t.avatar}</label>
                        <img 
                            className="w-28 h-28 rounded-full object-cover mx-auto ring-2 ring-[var(--border-color)] p-0.5" 
                            src={avatarPreview || userProfile.avatarUrl} 
                            alt="User avatar" 
                        />
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleAvatarChange}
                            accept="image/*"
                            className="hidden"
                        />
                        <button 
                            onClick={() => fileInputRef.current?.click()}
                            className="mt-3 outline-btn px-4 py-1.5 text-xs font-medium"
                        >
                            {t.updateAvatar}
                        </button>
                    </div>

                    {/* Form */}
                    <div className="w-full space-y-4">
                        <InputField label={t.form.name} value={name} onChange={(e) => setName(e.target.value)} isGlassEffect={isGlassEffect} />
                        
                        {/* Email section with change button */}
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <label className="block caption-text font-medium" style={{ color: 'var(--text-secondary)' }}>{t.form.email}</label>
                                <button
                                    onClick={() => {
                                        setShowEmailChangeModal(true);
                                        setNewEmail('');
                                        setEmailStep('input');
                                    }}
                                    className="text-xs font-semibold text-[var(--primary-color)] hover:underline"
                                >
                                    Change
                                </button>
                            </div>
                            <input
                                type="email"
                                value={email}
                                disabled
                                className="w-full vercel-input opacity-60"
                            />
                        </div>

                        <div className="grid grid-cols-1 gap-4">
                            <InputField label={t.form.storage} value={formatBytes(userProfile.downloadedBytes)} disabled isGlassEffect={isGlassEffect} />
                        </div>
                    </div>
                </div>
                
                <div className="flex justify-end mt-8 border-t border-[var(--border-color)] pt-6">
                    <button 
                        onClick={handleSave} 
                        className={`glowing-btn pill-btn font-medium py-2.5 px-8 text-sm ${
                            saveStatus === 'success' 
                            ? 'bg-[var(--success-color)]' 
                            : ''
                        }`}
                        disabled={saveStatus === 'success' || emailLoading}
                    >
                        {saveStatus === 'success' ? (
                            <span className="flex items-center gap-2">
                                <CheckIcon className="w-5 h-5"/>
                                {t.saveButtonSuccess} 
                            </span>
                        ) : (
                            t.saveButton
                        )}
                    </button>
                </div>
            </div>

            {/* Email Change Modal */}
            {showEmailChangeModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="rounded-xl border border-[var(--border-color)] p-6 max-w-md w-full bg-[var(--background-card)] elevation-5">
                        <h3 className="display-sm text-[var(--text-primary)] mb-4">Change Email</h3>
                        
                        {emailStep === 'input' ? (
                            <>
                                <input
                                    type="email"
                                    value={newEmail}
                                    onChange={(e) => setNewEmail(e.target.value)}
                                    placeholder="Enter new email"
                                    className="w-full vercel-input mb-4"
                                />
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setShowEmailChangeModal(false)}
                                        className="flex-1 px-4 py-2 rounded-lg bg-[var(--text-secondary)]/20 text-[var(--text-secondary)] font-semibold hover:bg-[var(--text-secondary)]/30 transition-colors"
                                        disabled={emailLoading}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleRequestEmailOtp}
                                        className="flex-1 px-4 py-2 rounded-lg bg-[var(--primary-color)] text-white font-semibold hover:opacity-80 transition-opacity disabled:opacity-50"
                                        disabled={emailLoading || !newEmail}
                                    >
                                        {emailLoading ? 'Sending...' : 'Send OTP'}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <p className="text-[var(--text-secondary)] text-sm mb-4">Enter the OTP sent to {newEmail}</p>
                                <input
                                    type="text"
                                    value={emailOtp}
                                    onChange={(e) => setEmailOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    placeholder="000000"
                                    maxLength={6}
                                    className="w-full border border-[var(--border-color)] text-[var(--text-primary)] rounded-lg px-3 py-2 mb-4 text-center text-2xl font-mono focus:ring-2 focus:ring-[var(--primary-color)]"
                                />
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setEmailStep('input')}
                                        className="flex-1 px-4 py-2 rounded-lg bg-[var(--text-secondary)]/20 text-[var(--text-secondary)] font-semibold hover:bg-[var(--text-secondary)]/30 transition-colors"
                                        disabled={emailLoading}
                                    >
                                        Back
                                    </button>
                                    <button
                                        onClick={handleVerifyEmailOtp}
                                        className="flex-1 px-4 py-2 rounded-lg bg-[var(--primary-color)] text-white font-semibold hover:opacity-80 transition-opacity disabled:opacity-50"
                                        disabled={emailLoading || emailOtp.length < 4}
                                    >
                                        {emailLoading ? 'Verifying...' : 'Verify'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Picture Resizer Modal */}
            {showPictureResizer && imageSrc && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="rounded-xl border border-[var(--border-color)] p-6 max-w-md w-full bg-[var(--background-card)] elevation-5">
                        <h3 className="display-sm text-[var(--text-primary)] mb-4">Resize Picture</h3>
                        
                        <div className="relative w-full h-64 mb-6 bg-black/10 rounded-xl overflow-hidden">
                            <Cropper
                                image={imageSrc}
                                crop={crop}
                                zoom={zoom}
                                aspect={1}
                                onCropChange={setCrop}
                                onCropComplete={onCropComplete}
                                onZoomChange={setZoom}
                            />
                        </div>
                        
                        <div className="mb-6">
                            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">Zoom</label>
                            <input
                                type="range"
                                value={zoom}
                                min={1}
                                max={3}
                                step={0.1}
                                aria-labelledby="Zoom"
                                onChange={(e) => setZoom(Number(e.target.value))}
                                className="w-full accent-[var(--primary-color)]"
                            />
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={() => {
                                    setShowPictureResizer(false);
                                    setPictureFile(null);
                                    setImageSrc(null);
                                }}
                                className="flex-1 px-4 py-2 rounded-lg bg-[var(--text-secondary)]/20 text-[var(--text-secondary)] font-semibold hover:bg-[var(--text-secondary)]/30 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleResizeAndCrop}
                                className="flex-1 px-4 py-2 rounded-lg bg-[var(--primary-color)] text-white font-semibold hover:opacity-80 transition-opacity"
                            >
                                Apply & Crop
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProfileView;