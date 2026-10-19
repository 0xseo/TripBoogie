import Capacitor
class TripBoogieViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(TripBoogieAuthPlugin()) }
}
