import { env } from '../config/env.js';

interface EmailTemplateOptions {
    otp: string;
    purpose: 'registration' | 'password_reset' | 'email_change' | 'login';
    expiryMinutes: number;
}

const getPurposeText = (purpose: EmailTemplateOptions['purpose']) => {
    switch (purpose) {
        case 'registration':
            return 'Welcome to DocFlow! Use the verification code below to complete your registration.';
        case 'password_reset':
            return 'We received a request to reset your password. Use the verification code below to securely reset it.';
        case 'email_change':
            return 'You requested to change your email address. Use the verification code below to confirm this change.';
        case 'login':
            return 'Use the verification code below to log in to your account.';
    }
};

const getPurposeSubject = (purpose: EmailTemplateOptions['purpose']) => {
    switch (purpose) {
        case 'registration':
            return 'DocFlow - Verify your email';
        case 'password_reset':
            return 'DocFlow - Password Reset Verification';
        case 'email_change':
            return 'DocFlow - Confirm Email Change';
        case 'login':
            return 'DocFlow - Login Verification';
    }
};

export const buildOtpEmailHtml = ({ otp, purpose, expiryMinutes }: EmailTemplateOptions) => {
    const purposeText = getPurposeText(purpose);

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DocFlow Verification</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f9fafb; }
        .container { max-width: 600px; margin: 40px auto; padding: 32px; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); }
        .header { text-align: center; margin-bottom: 32px; }
        .header h1 { color: #111827; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.025em; }
        .content { margin-bottom: 32px; }
        .content p { margin: 0 0 16px; font-size: 16px; color: #4b5563; }
        .otp-container { display: flex; justify-content: center; margin: 32px 0; }
        .otp { display: inline-block; font-size: 36px; letter-spacing: 8px; font-weight: 700; padding: 16px 24px; border-radius: 8px; background: #f3f4f6; color: #111827; text-align: center; width: auto; margin: 0 auto; }
        .footer { text-align: center; margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb; }
        .footer p { margin: 0 0 8px; font-size: 14px; color: #6b7280; }
        .security-notice { font-size: 12px; color: #9ca3af; margin-top: 16px; }
        
        @media (prefers-color-scheme: dark) {
            body { background-color: #111827; color: #e5e7eb; }
            .container { background: #1f2937; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.5); }
            .header h1 { color: #f9fafb; }
            .content p { color: #d1d5db; }
            .otp { background: #374151; color: #f9fafb; }
            .footer { border-top-color: #374151; }
            .footer p { color: #9ca3af; }
            .security-notice { color: #6b7280; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>DocFlow</h1>
        </div>
        <div class="content">
            <p>${purposeText}</p>
            <div class="otp-container">
                <div class="otp">${otp}</div>
            </div>
            <p>This code will expire in <strong>${expiryMinutes} minutes</strong>.</p>
            <p>If you did not request this, please safely ignore this email.</p>
        </div>
        <div class="footer">
            <p>Need help? Contact support at support@docflow.com</p>
            <p class="security-notice">Security Notice: DocFlow team will never ask for your verification code. Do not share this code with anyone.</p>
        </div>
    </div>
</body>
</html>
    `;
};

export const buildOtpEmail = (options: EmailTemplateOptions) => {
    return {
        subject: getPurposeSubject(options.purpose),
        html: buildOtpEmailHtml(options),
        text: `Your DocFlow verification code is ${options.otp}. It expires in ${options.expiryMinutes} minutes. If you did not request this, please ignore this email.`,
    };
};
