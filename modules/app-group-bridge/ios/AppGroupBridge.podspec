Pod::Spec.new do |s|
  s.name           = 'AppGroupBridge'
  s.version        = '1.0.0'
  s.summary        = 'Local Expo module: App Group shared-container read/write for the Share Extension handoff.'
  s.description    = 'Local Expo module: App Group shared-container read/write for the Share Extension handoff.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
