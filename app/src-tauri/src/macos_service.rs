//! macOS Services integration: "Speak Selection with Kokoro".
//!
//! The service is declared under `NSServices` in `Info.plist`; macOS delivers
//! the user's selected text on a pasteboard to the provider registered here.

use std::sync::OnceLock;

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{define_class, msg_send, AllocAnyThread, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSPasteboard, NSPasteboardTypeString};
use objc2_foundation::{NSObject, NSString};
use tauri::AppHandle;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "KokoroSpeakSelectionProvider"]
    struct SpeakSelectionProvider;

    impl SpeakSelectionProvider {
        #[unsafe(method(speakSelection:userData:error:))]
        fn speak_selection(
            &self,
            pboard: &NSPasteboard,
            _user_data: Option<&NSString>,
            _error: *mut *mut NSString,
        ) {
            let Some(text) = (unsafe { pboard.stringForType(NSPasteboardTypeString) }) else {
                return;
            };

            let text = text.to_string();
            if text.trim().is_empty() {
                return;
            }

            if let Some(app) = APP_HANDLE.get() {
                crate::queue_speak_selection(app, text);
            }
        }
    }
);

/// Registers the service provider with AppKit. Must run on the main thread
/// during app setup; a no-op anywhere else.
pub fn register(app: &AppHandle) {
    let Some(main_thread) = MainThreadMarker::new() else {
        return;
    };

    let _ = APP_HANDLE.set(app.clone());

    let provider: Retained<SpeakSelectionProvider> =
        unsafe { msg_send![SpeakSelectionProvider::alloc(), init] };
    let provider_object: &AnyObject = &provider;
    unsafe {
        NSApplication::sharedApplication(main_thread).setServicesProvider(Some(provider_object));
    }

    // AppKit keeps a weak reference to the services provider, so the object
    // must stay alive for the lifetime of the process.
    std::mem::forget(provider);
}
