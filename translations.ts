export interface Translation {
    sidebar: SidebarTranslation;
    dashboard: DashboardTranslation;
    converter: ConverterTranslation;
    compressor: CompressorTranslation;
    history: HistoryTranslation;
    settings: SettingsTranslation;
    profile: ProfileTranslation;
}

export interface SidebarTranslation {
    converter: string;
    dashboard: string;
    upload: string;
    compress: string;
    history: string;
    settings: string;
    profile: string;
}

export interface QuickConvertTranslation {
    title: string;
    dropText: string;
    supportText: string;
}

export interface DropzoneTranslation {
    title: string;
    subtitle: string;
    dragText: string;
    browseText: string;
    supportText: string;
}

export interface DashboardTranslation {
    title: string;
    subtitle: string;
    stats: {
        total: string;
        successful: string;
        failed: string;
        successRate: string;
    };
    quickConvert: QuickConvertTranslation;
    quickCompress: QuickConvertTranslation;
}

export interface CompressorTranslation {
    title: string;
    subtitle: string;
    status: {
        starting: string;
        compressing: string;
        error: string;
        zipping: string;
    };
    results: {
        title: string;
        downloadButton: string;
        startOverButton: string;
    };
    dropMore: string;
    globalQuality: string;
    compressButton: string;
    files: string;
    file: string;
    addMoreButton: string;
    dropzone: DropzoneTranslation;
    filetypes: {
        other: string;
    };
}

export interface ConverterTranslation {
    title: string;
    subtitle: string;
    dropzone: Omit<DropzoneTranslation, 'title' | 'subtitle'> & { title: string; subtitle: string; };
    status: {
        initializing: string;
        processing: string;
        generating: string;
        complete: string;
        error: string;
        suggestingName: string;
        creatingZip: string;
    },
    success: {
        title: string;
        subtitle: string;
        downloadButton: string;
        startOverButton: string;
        downloadZipButton: string;
        aiSuggestion: string;
        useSuggestionButton: string;
        fileNameLabel: string;
    },
    options: {
        merge: {
            pdf: string;
            zip: string;
        };
        convertButton: string;
        convertButtonLoading: string;
        file: string;
        files: string;
        addMoreButton: string;
        outputFormat: string;
        security: string;
        password: string;
        pageManagement: string;
        pageNumbers: string;
        pageNumbersDescription: string;
    },
    pageManager: {
        title: string;
        pages: string;
        save: string;
    },
    toasts: {
        successMultiple: string;
        successSingle: string;
        failMultiple: string;
        failSingle: string;
        partialSuccess: string;
    }
}

export interface HistoryTranslation {
    title: string;
    subtitle: string;
    tableHeaders: {
        fileName: string;
        date: string;
        status: string;
        action: string;
    };
    noHistory: string;
}

export interface SettingsTranslation {
    title: string;
    subtitle: string;
    sections: {
        general: {
            title: string;
            language: string;
            theme: string;
            themeOptions: {
                light: string;
                dark: string;
                system: string;
            };
            backgroundAnimation: string;
            backgroundAnimationDescription: string;
            appearance: string;
            fontSize: string;
            fontSizeOptions: {
                sm: string;
                md: string;
                lg: string;
            };
            fontFamily: string;
        };
        conversion: {
            title: string;
            defaultCompression: string;
            compressionOptions: {
                low: string;
                medium: string;
                high: string;
            };
            autoDelete: string;
            autoDeleteDescription: string;
        };
    };
    saveButton: string;
}

export interface ProfileTranslation {
    title: string;
    subtitle: string;
    avatar: string;
    updateAvatar: string;
    form: {
        name: string;
        email: string;
        plan: string;
        storage: string;
    };
    saveButton: string;
    saveButtonSuccess: string;
}

export const translations: { [key: string]: Translation } = {
    en: {
        sidebar: {
            converter: 'Converter',
            dashboard: 'Dashboard',
            upload: 'Upload',
            compress: 'Compress',
            history: 'History',
            settings: 'Settings',
            profile: 'Profile',
        },
        dashboard: {
            title: 'Dashboard',
            subtitle: "Welcome back! Here's your conversion overview.",
            stats: {
                total: 'Total Conversions',
                successful: 'Successful',
                failed: 'Failed',
                successRate: 'Success Rate',
            },
            quickConvert: {
                title: 'Quick Convert',
                dropText: 'Drop your files here',
                supportText: 'Supports PDF, TIFF, PNG, JPEG/JPG, and more',
            },
            quickCompress: {
                title: 'Quick Compress',
                dropText: 'Drop files to compress',
                supportText: 'Reduce size of PDFs & Images',
            },
        },
        converter: {
            title: 'Upload Files',
            subtitle: 'Select images or PDFs to begin the processing.',
            dropzone: {
                title: 'Convert & Merge Files Instantly',
                subtitle: 'Secure, fast, and entirely in-browser. Drag and drop your images or existing PDFs and get a high-quality document in seconds.',
                dragText: 'Drag & drop files here',
                browseText: 'click to browse',
                supportText: 'Supports PDF, TIFF, JPEG/JPG, PNG, and BMP files'
            },
            status: {
                initializing: 'Initializing processing...',
                processing: 'Processing file',
                generating: 'Generating file...',
                complete: 'Processing complete!',
                error: 'Error during processing',
                suggestingName: 'AI is suggesting a filename...',
                creatingZip: 'Creating ZIP archive...'
            },
            success: {
                title: 'Processing Successful!',
                subtitle: 'Your file(s) are ready for download.',
                downloadButton: 'Download',
                startOverButton: 'Start Over',
                downloadZipButton: 'Download All as ZIP',
                aiSuggestion: 'AI Suggestion',
                useSuggestionButton: 'Use Suggestion',
                fileNameLabel: 'File Name'
            },
            options: {
                merge: {
                    pdf: 'Merge into single PDF',
                    zip: 'Combine into ZIP archive'
                },
                convertButton: 'Process',
                convertButtonLoading: 'Processing...',
                file: 'file',
                files: 'files',
                addMoreButton: 'Add More Files',
                outputFormat: 'Output Format',
                security: 'Security',
                password: 'PDF Password (optional)',
                pageManagement: 'Manage Pages',
                pageNumbers: 'Page Numbers',
                pageNumbersDescription: 'Add page numbers to the PDF footer (e.g., Page 1 / 5).',
            },
            pageManager: {
                title: "Manage Pages",
                pages: "pages",
                save: "Save Changes",
            },
            toasts: {
                successMultiple: '{count} files processed successfully!',
                successSingle: 'File processed successfully!',
                failMultiple: '{count} files failed to process.',
                failSingle: 'File processing failed.',
                partialSuccess: '{successCount} succeeded, {failureCount} failed.',
            }
        },
        compressor: {
            title: 'Compress Files',
            subtitle: 'Reduce the file size of your images and PDFs.',
            status: {
                starting: 'Starting compression...',
                compressing: 'Compressing',
                error: 'Error compressing',
                zipping: 'Creating ZIP archive...'
            },
            results: {
                title: 'Compression Complete!',
                downloadButton: 'Download ZIP',
                startOverButton: 'Start Over'
            },
            dropMore: 'Drop to add more files',
            globalQuality: 'Global Image Quality',
            compressButton: 'Compress',
            files: 'files',
            file: 'file',
            addMoreButton: 'Add More',
            dropzone: {
                title: 'Compress Files Instantly',
                subtitle: 'Drag and drop your images or PDFs to reduce their size without compromising quality.',
                dragText: 'Drag & drop files here',
                browseText: 'click to browse',
                supportText: 'Supports PDF, JPEG/JPG, PNG files for compression.'
            },
            filetypes: {
                other: 'File type not compressible client-side'
            }
        },
        history: {
            title: 'Conversion History',
            subtitle: 'Review your past file processing.',
            tableHeaders: {
                fileName: 'File Name',
                date: 'Date',
                status: 'Status',
                action: 'Action'
            },
            noHistory: 'You have no processing history yet.'
        },
        settings: {
            title: 'Settings',
            subtitle: 'Customize your application experience.',
            sections: {
                general: {
                    title: 'General',
                    language: 'Language',
                    theme: 'Theme',
                    themeOptions: {
                        light: 'Light',
                        dark: 'Dark',
                        system: 'System'
                    },
                    backgroundAnimation: 'Background Animation',
                    backgroundAnimationDescription: 'Enable subtle background motion (dark mode only).',
                    appearance: 'Appearance',
                    fontSize: 'Font Size',
                    fontSizeOptions: {
                        sm: 'Small',
                        md: 'Medium',
                        lg: 'Large'
                    },
                    fontFamily: 'Font Style',
                },
                conversion: {
                    title: 'Conversion',
                    defaultCompression: 'Default Compression',
                    compressionOptions: {
                        low: 'Low',
                        medium: 'Medium',
                        high: 'High'
                    },
                    autoDelete: 'Auto-delete files',
                    autoDeleteDescription: 'Automatically delete source files after conversion.'
                }
            },
            saveButton: 'Save Changes'
        },
        profile: {
            title: 'Profile',
            subtitle: 'Manage your personal information and plan.',
            avatar: 'Profile Picture',
            updateAvatar: 'Update Picture',
            form: {
                name: 'Full Name',
                email: 'Email Address',
                plan: 'Current Plan',
                storage: 'Storage Used'
            },
            saveButton: 'Save Profile',
            saveButtonSuccess: 'Saved!',
        },
    },
    hi: {
        sidebar: {
            converter: 'कनवर्टर',
            dashboard: 'डैशबोर्ड',
            upload: 'अपलोड',
            compress: 'संपीड़न',
            history: 'इतिहास',
            settings: 'सेटिंग्स',
            profile: 'प्रोफ़ाइल',
        },
        dashboard: {
            title: 'डैशबोर्ड',
            subtitle: 'वापसी पर स्वागत है! यहाँ आपका रूपांतरण अवलोकन है।',
            stats: {
                total: 'कुल रूपांतरण',
                successful: 'सफल',
                failed: 'विफल',
                successRate: 'सफलता दर',
            },
            quickConvert: {
                title: 'त्वरित रूपांतरण',
                dropText: 'अपनी फ़ाइलें यहाँ ड्रॉप करें',
                supportText: 'PDF, TIFF, PNG, JPEG/JPG और अधिक का समर्थन करता है',
            },
            quickCompress: {
                title: 'त्वरित संपीड़न',
                dropText: 'संपीड़ित करने के लिए फ़ाइलें ड्रॉप करें',
                supportText: 'PDF और छवियों का आकार कम करें',
            },
        },
        converter: {
            title: 'फाइलें अपलोड करें',
            subtitle: 'संसाधन प्रक्रिया शुरू करने के लिए चित्र या PDF चुनें।',
            dropzone: {
                title: 'फ़ाइलों को तुरंत बदलें और मिलाएं',
                subtitle: 'सुरक्षित, तेज़, और पूरी तरह से ब्राउज़र में। अपनी छवियों या मौजूदा PDF को ड्रैग और ड्रॉप करें।',
                dragText: 'फ़ाइलें यहाँ खींचें और छोड़ें',
                browseText: 'ब्राउज़ करने के लिए क्लिक करें',
                supportText: 'PDF, TIFF, JPEG/JPG, PNG, और BMP फ़ाइलों का समर्थन करता है'
            },
            status: {
                initializing: 'संसाधन शुरू हो रहा है...',
                processing: 'फ़ाइल संसाधित हो रही है',
                generating: 'फ़ाइल बना रहा है...',
                complete: 'संसाधन पूरा हुआ!',
                error: 'संसाधन के दौरान त्रुटि',
                suggestingName: 'AI एक फ़ाइल नाम सुझा रहा है...',
                creatingZip: 'ZIP संग्रह बनाया जा रहा है...'
            },
            success: {
                title: 'संसाधन सफल!',
                subtitle: 'आपकी फ़ाइल(फ़ाइलें) डाउनलोड के लिए तैयार हैं।',
                downloadButton: 'डाउनलोड',
                startOverButton: 'फिर से शुरू करें',
                downloadZipButton: 'सभी को ZIP में डाउनलोड करें',
                aiSuggestion: 'AI सुझाव',
                useSuggestionButton: 'सुझाव का प्रयोग करें',
                fileNameLabel: 'फ़ाइल का नाम'
            },
            options: {
                merge: {
                    pdf: 'एक PDF में मिलाएं',
                    zip: 'ZIP संग्रह में मिलाएं'
                },
                convertButton: 'संसाधित करें',
                convertButtonLoading: 'संसाधित हो रहा है...',
                file: 'फ़ाइल',
                files: 'फ़ाइलें',
                addMoreButton: 'और फ़ाइलें जोड़ें',
                outputFormat: 'आउटपुट प्रारूप',
                security: 'सुरक्षा',
                password: 'PDF पासवर्ड (वैकल्पिक)',
                pageManagement: 'पेज प्रबंधित करें',
                pageNumbers: 'पृष्ठ संख्या',
                pageNumbersDescription: 'PDF फुटर में पृष्ठ संख्या जोड़ें।',
            },
            pageManager: {
                title: "पेज प्रबंधित करें",
                pages: "पेज",
                save: "बदलाव सहेजें",
            },
            toasts: {
                successMultiple: '{count} फ़ाइलें सफलतापूर्वक संसाधित हुईं!',
                successSingle: 'फ़ाइल सफलतापूर्वक संसाधित हुई!',
                failMultiple: '{count} फ़ाइलें विफल रहीं।',
                failSingle: 'फ़ाइल संसाधन विफल रहा।',
                partialSuccess: '{successCount} सफल, {failureCount} विफल।',
            }
        },
        compressor: {
            title: 'फ़ाइलें संपीड़ित करें',
            subtitle: 'अपनी छवियों और PDF का फ़ाइल आकार कम करें।',
            status: {
                starting: 'संपीड़न शुरू हो रहा है...',
                compressing: 'संपीड़ित हो रहा है',
                error: 'संपीड़न में त्रुटि',
                zipping: 'ZIP संग्रह बना रहा है...'
            },
            results: {
                title: 'संपीड़न पूर्ण!',
                downloadButton: 'ZIP डाउनलोड करें',
                startOverButton: 'फिर से शुरू करें'
            },
            dropMore: 'और फ़ाइलें जोड़ने के लिए ड्रॉप करें',
            globalQuality: 'वैश्विक छवि गुणवत्ता',
            compressButton: 'संपीड़ित करें',
            files: 'फ़ाइलें',
            file: 'फ़ाइल',
            addMoreButton: 'और जोड़ें',
            dropzone: {
                title: 'फ़ाइलों को तुरंत संपीड़ित करें',
                subtitle: 'गुणवत्ता से समझौता किए बिना उनका आकार कम करने के लिए अपनी छवियों या PDF को खींचें और छोड़ें।',
                dragText: 'फ़ाइलें यहाँ खींचें और छोड़ें',
                browseText: 'ब्राउज़ करने के लिए क्लिक करें',
                supportText: 'संपीड़न के लिए PDF, JPEG/JPG, PNG फ़ाइलों का समर्थन करता है।'
            },
            filetypes: {
                other: 'फ़ाइल प्रकार क्लाइंट-साइड पर संपीड़ित नहीं किया जा सकता'
            }
        },
        history: {
            title: 'रूपांतरण इतिहास',
            subtitle: 'अपने पिछले फ़ाइल संसाधन की समीक्षा करें।',
            tableHeaders: {
                fileName: 'फ़ाइल का नाम',
                date: 'तारीख',
                status: 'स्थिति',
                action: 'कार्रवाई'
            },
            noHistory: 'आपका अभी तक कोई इतिहास नहीं है।'
        },
        settings: {
            title: 'सेटिंग्स',
            subtitle: 'अपने एप्लिकेशन अनुभव को अनुकूलित करें।',
            sections: {
                general: {
                    title: 'सामान्य',
                    language: 'भाषा',
                    theme: 'थीम',
                    themeOptions: {
                        light: 'लाइट',
                        dark: 'डार्क',
                        system: 'सिस्टम'
                    },
                    backgroundAnimation: 'पृष्ठभूमि एनिमेशन',
                    backgroundAnimationDescription: 'सूक्ष्म पृष्ठभूमि गति सक्षम करें।',
                    appearance: 'दिखावट',
                    fontSize: 'फ़ॉन्ट आकार',
                    fontSizeOptions: {
                        sm: 'छोटा',
                        md: 'मध्यम',
                        lg: 'बड़ा'
                    },
                    fontFamily: 'फ़ॉन्ट शैली',
                },
                conversion: {
                    title: 'रूपांतरण',
                    defaultCompression: 'डिफ़ॉल्ट संपीड़न',
                    compressionOptions: {
                        low: 'कम',
                        medium: 'मध्यम',
                        high: 'उच्च'
                    },
                    autoDelete: 'फ़ाइलें स्वतः हटाएं',
                    autoDeleteDescription: 'रूपांतरण के बाद स्रोत फ़ाइलों को हटाएं।'
                }
            },
            saveButton: 'बदलाव सहेजें'
        },
        profile: {
            title: 'प्रोफ़ाइल',
            subtitle: 'अपनी व्यक्तिगत जानकारी और योजना प्रबंधित करें।',
            avatar: 'प्रोफ़ाइल चित्र',
            updateAvatar: 'चित्र अपडेट करें',
            form: {
                name: 'पूरा नाम',
                email: 'ईमेल पता',
                plan: 'वर्तमान योजना',
                storage: 'प्रयुक्त भंडारण'
            },
            saveButton: 'प्रोफ़ाइल सहेजें',
            saveButtonSuccess: 'सहेजा गया!',
        },
    },
    bn: {
        sidebar: {
            converter: 'রূপান্তরকারী',
            dashboard: 'ড্যাশবোর্ড',
            upload: 'আপলোড',
            compress: 'সংকোচন',
            history: 'ইতিহাস',
            settings: 'সেটিংস',
            profile: 'প্রোফাইল',
        },
        dashboard: {
            title: 'ড্যাশবোর্ড',
            subtitle: 'ফিরে আসার জন্য স্বাগতম!',
            stats: {
                total: 'মোট রূপান্তর',
                successful: 'সফল',
                failed: 'ব্যর্থ',
                successRate: 'সাফল্যের হার',
            },
            quickConvert: {
                title: 'দ্রুত রূপান্তর',
                dropText: 'আপনার ফাইলগুলি এখানে ফেলুন',
                supportText: 'PDF, TIFF, PNG, JPEG/JPG এবং আরও অনেক কিছু সমর্থন করে',
            },
            quickCompress: {
                title: 'দ্রুত সংকোচন',
                dropText: 'সংকোচনের জন্য ফাইল ফেলুন',
                supportText: 'PDF এবং ছবির আকার কমান',
            },
        },
        converter: {
            title: 'ফাইল আপলোড করুন',
            subtitle: 'প্রসেসিং শুরু করতে ছবি বা PDF নির্বাচন করুন।',
            dropzone: {
                title: 'ফাইলগুলিকে অবিলম্বে রূপান্তর করুন এবং মার্জ করুন',
                subtitle: 'নিরাপদ, দ্রুত, এবং সম্পূর্ণরূপে ব্রাউজারে। আপনার ছবি বা বিদ্যমান PDF টেনে আনুন।',
                dragText: 'ফাইলগুলি এখানে টেনে আনুন এবং ফেলুন',
                browseText: 'ব্রাউজ করতে ক্লিক করুন',
                supportText: 'PDF, TIFF, JPEG/JPG, PNG, এবং BMP ফাইল সমর্থন করে'
            },
            status: {
                initializing: 'প্রসেসিং শুরু হচ্ছে...',
                processing: 'ফাইল প্রসেস করা হচ্ছে',
                generating: 'ফাইল তৈরি করা হচ্ছে...',
                complete: 'প্রসেসিং সম্পন্ন!',
                error: 'প্রসেসিং করার সময় ত্রুটি',
                suggestingName: 'AI একটি ফাইলের নাম প্রস্তাব করছে...',
                creatingZip: 'ZIP আর্কাইভ তৈরি হচ্ছে...'
            },
            success: {
                title: 'প্রসেসিং সফল!',
                subtitle: 'আপনার ফাইল(গুলি) ডাউনলোডের জন্য প্রস্তুত।',
                downloadButton: 'ডাউনলোড করুন',
                startOverButton: 'আবার শুরু করুন',
                downloadZipButton: 'সবগুলি ZIP হিসাবে ডাউনলোড করুন',
                aiSuggestion: 'AI প্রস্তাবনা',
                useSuggestionButton: 'প্রস্তাবনা ব্যবহার করুন',
                fileNameLabel: 'ফাইলের নাম'
            },
            options: {
                merge: {
                    pdf: 'একক PDF-এ মার্জ করুন',
                    zip: 'ZIP আর্কাইভে একত্রিত করুন'
                },
                convertButton: 'প্রসেস করুন',
                convertButtonLoading: 'প্রসেস করা হচ্ছে...',
                file: 'ফাইল',
                files: 'ফাইল',
                addMoreButton: 'আরও ফাইল যোগ করুন',
                outputFormat: 'আউটপুট ফরম্যাট',
                security: 'নিরাপত্তা',
                password: 'PDF পাসওয়ার্ড (ঐচ্ছিক)',
                pageManagement: 'পৃষ্ঠা পরিচালনা',
                pageNumbers: 'পৃষ্ঠা নম্বর',
                pageNumbersDescription: 'পিডিএফ ফুটার-এ পৃষ্ঠা নম্বর যোগ করুন।',
            },
            pageManager: {
                title: "পৃষ্ঠা পরিচালনা করুন",
                pages: "পৃষ্ঠা",
                save: "পরিবর্তনগুলি সংরক্ষণ করুন",
            },
            toasts: {
                successMultiple: '{count}টি ফাইল সফলভাবে প্রসেস করা হয়েছে!',
                successSingle: 'ফাইল সফলভাবে প্রসেস করা হয়েছে!',
                failMultiple: '{count}টি ফাইল প্রসেস করতে ব্যর্থ হয়েছে।',
                failSingle: 'ফাইল প্রসেসিং ব্যর্থ হয়েছে।',
                partialSuccess: '{successCount}টি সফল, {failureCount}টি ব্যর্থ।',
            }
        },
        compressor: {
            title: 'ফাইল সংকোচন করুন',
            subtitle: 'আপনার ছবি এবং PDF ফাইলের আকার কমান।',
            status: {
                starting: 'সংকোচন শুরু হচ্ছে...',
                compressing: 'সংকোচন করা হচ্ছে',
                error: 'সংকোচনে ত্রুটি',
                zipping: 'ZIP আর্কাইভ তৈরি হচ্ছে...'
            },
            results: {
                title: 'সংকোচন সম্পন্ন!',
                downloadButton: 'ZIP ডাউনলোড করুন',
                startOverButton: 'আবার শুরু করুন'
            },
            dropMore: 'আরও ফাইল যোগ করতে ফেলুন',
            globalQuality: 'গ্লোবাল ছবির গুণমান',
            compressButton: 'সংকোচন করুন',
            files: 'ফাইল',
            file: 'ফাইল',
            addMoreButton: 'আরও যোগ করুন',
            dropzone: {
                title: 'তাৎক্ষণিকভাবে ফাইল সংকোচন করুন',
                subtitle: 'গুণমান না হারিয়ে ফাইলের আকার কমাতে আপনার ছবি বা PDF ফাইলগুলি টেনে আনুন।',
                dragText: 'ফাইলগুলি এখানে টেনে আনুন এবং ফেলুন',
                browseText: 'ব্রাউজ করতে ক্লিক করুন',
                supportText: 'সংকোচনের জন্য PDF, JPEG/JPG, PNG ফাইল সমর্থন করে।'
            },
            filetypes: {
                other: 'এই ফাইল টাইপ ক্লায়েন্ট-সাইডে সংকোচন করা যায় না'
            }
        },
        history: {
            title: 'রূপান্তর ইতিহাস',
            subtitle: 'আপনার অতীতের ফাইল প্রসেসিং পর্যালোচনা করুন।',
            tableHeaders: {
                fileName: 'ফাইলের নাম',
                date: 'তারিখ',
                status: 'অবস্থা',
                action: 'কর্ম'
            },
            noHistory: 'আপনার এখনও কোন ইতিহাস নেই।'
        },
        settings: {
            title: 'সেটিংস',
            subtitle: 'আপনার অভিজ্ঞতা কাস্টমাইজ করুন।',
            sections: {
                general: {
                    title: 'সাধারণ',
                    language: 'ভাষা',
                    theme: 'থিম',
                    themeOptions: {
                        light: 'আলো',
                        dark: 'অন্ধকার',
                        system: 'সিস্টেম'
                    },
                    backgroundAnimation: 'পটভূমি অ্যানিমেশন',
                    backgroundAnimationDescription: 'পটভূমি গতি সক্ষম করুন।',
                    appearance: 'চেহারা',
                    fontSize: 'ফন্টের আকার',
                    fontSizeOptions: {
                        sm: 'ছোট',
                        md: 'মাঝারি',
                        lg: 'বড়'
                    },
                    fontFamily: 'ফন্ট শৈলী',
                },
                conversion: {
                    title: 'রূপান্তর',
                    defaultCompression: 'ডিফল্ট কম্প্রেশন',
                    compressionOptions: {
                        low: 'নিম্ন',
                        medium: 'মাঝারি',
                        high: 'উচ্চ'
                    },
                    autoDelete: 'ফাইলগুলি স্বয়ংক্রিয়ভাবে মুছুন',
                    autoDeleteDescription: 'রূপান্তরের পরে উৎস ফাইলগুলি মুছুন।'
                }
            },
            saveButton: 'পরিবর্তনগুলি সংরক্ষণ করুন'
        },
        profile: {
            title: 'প্রোফাইল',
            subtitle: 'আপনার তথ্য এবং পরিকল্পনা পরিচালনা করুন।',
            avatar: 'প্রোফাইল ছবি',
            updateAvatar: 'ছবি আপডেট করুন',
            form: {
                name: 'পুরো নাম',
                email: 'ইমেল ঠিকানা',
                plan: 'বর্তমান পরিকল্পনা',
                storage: 'ব্যবহৃত স্টোরেজ'
            },
            saveButton: 'প্রোফাইল সংরক্ষণ করুন',
            saveButtonSuccess: 'সংরক্ষিত!',
        },
    },
    te: {
        sidebar: {
            converter: 'కన్వర్టర్',
            dashboard: 'డాష్‌బోర్డ్',
            upload: 'అప్‌లోడ్',
            compress: 'కంప్రెస్',
            history: 'చరిత్ర',
            settings: 'సెట్టింగ్‌లు',
            profile: 'ప్రొఫైల్',
        },
        dashboard: {
            title: 'డాష్‌బోర్డ్',
            subtitle: "తిరిగి స్వాగతం!",
            stats: {
                total: 'మొత్తం మార్పిడులు',
                successful: 'విజయవంతమైనవి',
                failed: 'విఫలమైనవి',
                successRate: 'విజయ రేటు',
            },
            quickConvert: {
                title: 'త్వరిత మార్పిడి',
                dropText: 'మీ ఫైల్‌లను ఇక్కడ వదలండి',
                supportText: 'PDF, TIFF, PNG, JPEG/JPG మరియు మరిన్నింటికి మద్దతు ఇస్తుంది',
            },
            quickCompress: {
                title: 'త్వరిత కంప్రెస్',
                dropText: 'కంప్రెస్ చేయడానికి ఫైల్‌లను వదలండి',
                supportText: 'PDFలు & చిత్రాల పరిమాణాన్ని తగ్గించండి',
            },
        },
        converter: {
            title: 'ఫైల్‌లను అప్‌లోడ్ చేయండి',
            subtitle: 'ప్రక్రియను ప్రారంభించడానికి చిత్రాలు లేదా PDFలను ఎంచుకోండి.',
            dropzone: {
                title: 'ఫైల్‌లను తక్షణమే మార్చండి మరియు విలీనం చేయండి',
                subtitle: 'సురక్షితమైన, వేగవంతమైన, మరియు పూర్తిగా మీ బ్రౌజర్‌లో. మీ చిత్రాలు లేదా ఇప్పటికే ఉన్న PDFలను లాగి వదలండి.',
                dragText: 'ఫైల్‌లను ఇక్కడ లాగి వదలండి',
                browseText: 'బ్రౌజ్ చేయడానికి క్లిక్ చేయండి',
                supportText: 'PDF, TIFF, JPEG/JPG, PNG, మరియు BMP ఫైల్‌లకు మద్దతు ఇస్తుంది'
            },
            status: {
                initializing: 'ప్రారంభిస్తోంది...',
                processing: 'ఫైల్‌ను ప్రాసెస్ చేస్తోంది',
                generating: 'ఫైల్‌ను సృష్టిస్తోంది...',
                complete: 'పూర్తయింది!',
                error: 'లోపం సంభవించింది',
                suggestingName: 'AI ఫైల్ పేరును సూచిస్తోంది...',
                creatingZip: 'ZIP ఆర్కైవ్ సృష్టిస్తోంది...'
            },
            success: {
                title: 'విజయవంతమైంది!',
                subtitle: 'మీ ఫైల్(లు) డౌన్‌లోడ్ కోసం సిద్ధంగా ఉన్నాయి.',
                downloadButton: 'డౌన్‌లోడ్',
                startOverButton: 'మళ్ళీ ప్రారంభించండి',
                downloadZipButton: 'అన్నింటినీ ZIPగా డౌన్‌లోడ్ చేయండి',
                aiSuggestion: 'AI సూచన',
                useSuggestionButton: 'సూచనను ఉపయోగించండి',
                fileNameLabel: 'ఫైల్ పేరు'
            },
            options: {
                merge: {
                    pdf: 'ఒకే PDFలో విలీనం చేయండి',
                    zip: 'ZIP ఆర్కైవ్‌లో కలపండి'
                },
                convertButton: 'ప్రాసెస్ చేయండి',
                convertButtonLoading: 'ప్రాసెస్ అవుతోంది...',
                file: 'ఫైల్',
                files: 'ఫైల్‌లు',
                addMoreButton: 'మరిన్ని ఫైల్‌లను జోడించండి',
                outputFormat: 'అవుట్‌పుట్ ఫార్మాట్',
                security: 'భద్రత',
                password: 'PDF పాస్‌వర్డ్ (ఐచ్ఛికం)',
                pageManagement: 'పేజీలను నిర్వహించండి',
                pageNumbers: 'పేజీ సంఖ్యలు',
                pageNumbersDescription: 'PDF ఫుటర్‌లో పేజీ సంఖ్యలను జోడించండి.',
            },
            pageManager: {
                title: "పేజీలను నిర్వహించండి",
                pages: "పేజీలు",
                save: "మార్పులను సేవ్ చేయండి",
            },
            toasts: {
                successMultiple: '{count} ఫైల్‌లు విజయవంతంగా ప్రాసెస్ చేయబడ్డాయి!',
                successSingle: 'ఫైల్ విజయవంతంగా ప్రాసెస్ చేయబడింది!',
                failMultiple: '{count} ఫైల్‌లు విఫలమయ్యాయి.',
                failSingle: 'ఫైల్ ప్రాసెసింగ్ విఫలమైంది.',
                partialSuccess: '{successCount} విజయవంతమయ్యాయి, {failureCount} విఫలమయ్యాయి.',
            }
        },
        compressor: {
            title: 'ఫైల్‌లను కంప్రెస్ చేయండి',
            subtitle: 'మీ చిత్రాలు మరియు PDFల ఫైల్ పరిమాణాన్ని తగ్గించండి.',
            status: {
                starting: 'కంప్రెషన్ ప్రారంభమవుతోంది...',
                compressing: 'కంప్రెస్ చేస్తోంది',
                error: 'కంప్రెషన్‌లో లోపం',
                zipping: 'ZIP ఆర్కైవ్‌ను సృష్టిస్తోంది...'
            },
            results: {
                title: 'కంప్రెషన్ పూర్తయింది!',
                downloadButton: 'ZIPని డౌన్‌లోడ్ చేయండి',
                startOverButton: 'మళ్లీ ప్రారంభించండి'
            },
            dropMore: 'మరిన్ని ఫైల్‌లను జోడించడానికి వదలండి',
            globalQuality: 'గ్లోబల్ చిత్ర నాణ్యత',
            compressButton: 'కంప్రెస్ చేయండి',
            files: 'ఫైల్‌లు',
            file: 'ఫైల్',
            addMoreButton: 'మరిన్ని జోడించండి',
            dropzone: {
                title: 'ఫైల్‌లను తక్షణమే కంప్రెస్ చేయండి',
                subtitle: 'నాణ్యతను కోల్పోకుండా వాటి పరిమాణాన్ని తగ్గించడానికి మీ చిత్రాలను లేదా PDFలను లాగి వదలండి.',
                dragText: 'ఫైల్‌లను ఇక్కడ లాగి వదలండి',
                browseText: 'బ్రౌజ్ చేయడానికి క్లిక్ చేయండి',
                supportText: 'కంప్రెషన్ కోసం PDF, JPEG/JPG, PNG ఫైల్‌లకు మద్దతు ఇస్తుంది.'
            },
            filetypes: {
                other: 'ఫైల్ రకం క్లయింట్-వైపు కంప్రెస్ చేయబడదు'
            }
        },
        history: {
            title: 'మార్పిడి చరిత్ర',
            subtitle: 'మీ గత ఫైల్ ప్రాసెసింగ్‌ను సమీక్షించండి.',
            tableHeaders: {
                fileName: 'ఫైల్ పేరు',
                date: 'తేదీ',
                status: 'స్థితి',
                action: 'చర్య'
            },
            noHistory: 'మీకు ఇంకా చరిత్ర లేదు.'
        },
        settings: {
            title: 'సెట్టింగ్‌లు',
            subtitle: 'మీ అనుభవాన్ని అనుకూలీకరించండి.',
            sections: {
                general: {
                    title: 'సాధారణం',
                    language: 'భాష',
                    theme: 'తీమ్',
                    themeOptions: {
                        light: 'లైట్',
                        dark: 'డార్క్',
                        system: 'సిస్టమ్'
                    },
                    backgroundAnimation: 'నేపథ్య యానిమేషన్',
                    backgroundAnimationDescription: 'నేపథ్య కదలికను ప్రారంభించండి.',
                    appearance: 'స్వరూపం',
                    fontSize: 'ఫాంట్ పరిమాణం',
                    fontSizeOptions: {
                        sm: 'చిన్నది',
                        md: 'మధ్యస్థం',
                        lg: 'పెద్దది'
                    },
                    fontFamily: 'ఫాంట్ శైలి',
                },
                conversion: {
                    title: 'మార్పిడి',
                    defaultCompression: 'డిఫాల్ట్ కంప్రెషన్',
                    compressionOptions: {
                        low: 'తక్కువ',
                        medium: 'మధ్యస్థం',
                        high: 'అధిక'
                    },
                    autoDelete: 'ఫైల్‌లను స్వయంచాలకంగా తొలగించండి',
                    autoDeleteDescription: 'మార్పిడి తర్వాత సోర్స్ ఫైల్‌లను తొలగించండి.'
                }
            },
            saveButton: 'మార్పులను సేవ్ చేయండి'
        },
        profile: {
            title: 'ప్రొఫైల్',
            subtitle: 'మీ సమాచారాన్ని నిర్వహించండి.',
            avatar: 'ప్రొఫైల్ చిత్రం',
            updateAvatar: 'చిత్రాన్ని నవీకరించండి',
            form: {
                name: 'పూర్తి పేరు',
                email: 'ఇమెయిల్ చిరునామా',
                plan: 'ప్రస్తుత ప్లాన్',
                storage: 'ఉపయోగించిన నిల్వ'
            },
            saveButton: 'ప్రొఫైల్‌ను సేవ్ చేయండి',
            saveButtonSuccess: 'సేవ్ చేయబడింది!',
        },
    }
};
