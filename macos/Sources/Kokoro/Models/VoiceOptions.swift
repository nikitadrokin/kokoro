struct VoiceOption: Identifiable {
    let value: String
    let label: String
    let badge: String?

    var id: String { value }
}

let voiceOptions: [VoiceOption] = [
    // American Female
    VoiceOption(value: "af_heart",   label: "af_heart",   badge: "Best female"),
    VoiceOption(value: "af_alloy",   label: "af_alloy",   badge: nil),
    VoiceOption(value: "af_aoede",   label: "af_aoede",   badge: nil),
    VoiceOption(value: "af_bella",   label: "af_bella",   badge: nil),
    VoiceOption(value: "af_jessica", label: "af_jessica", badge: nil),
    VoiceOption(value: "af_kore",    label: "af_kore",    badge: nil),
    VoiceOption(value: "af_nicole",  label: "af_nicole",  badge: nil),
    VoiceOption(value: "af_nova",    label: "af_nova",    badge: nil),
    VoiceOption(value: "af_river",   label: "af_river",   badge: nil),
    VoiceOption(value: "af_sarah",   label: "af_sarah",   badge: nil),
    VoiceOption(value: "af_sky",     label: "af_sky",     badge: nil),
    // American Male
    VoiceOption(value: "am_adam",    label: "am_adam",    badge: nil),
    VoiceOption(value: "am_echo",    label: "am_echo",    badge: nil),
    VoiceOption(value: "am_eric",    label: "am_eric",    badge: nil),
    VoiceOption(value: "am_fenrir",  label: "am_fenrir",  badge: nil),
    VoiceOption(value: "am_liam",    label: "am_liam",    badge: nil),
    VoiceOption(value: "am_michael", label: "am_michael", badge: "Best male"),
    VoiceOption(value: "am_onyx",    label: "am_onyx",    badge: nil),
    VoiceOption(value: "am_puck",    label: "am_puck",    badge: nil),
    VoiceOption(value: "am_santa",   label: "am_santa",   badge: nil),
]
