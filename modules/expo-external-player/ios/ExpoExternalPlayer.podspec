Pod::Spec.new do |s|
  s.name           = 'ExpoExternalPlayer'
  s.version        = '0.1.0'
  s.summary        = 'Opens videos in external players'
  s.description    = 'Expo module for opening videos in external players on Android and iOS'
  s.author         = 'seanime'
  s.homepage       = 'https://github.com/5rahim/seanime'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = "*.{h,m,mm,swift,hpp,cpp}"
end
