Pod::Spec.new do |s|
  s.name           = 'ExpoNativeMenu'
  s.version        = '0.1.0'
  s.summary        = 'Native iOS dropdown menu'
  s.description    = 'Shows a native UIMenu from a transparent button placed over a React Native view'
  s.author         = 'seanime'
  s.homepage       = 'https://github.com/5rahim/seanime'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
